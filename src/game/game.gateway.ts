import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import {
  ClientEvents,
  emptyPayloadSchema,
  joinRoomPayloadSchema,
  kickPayloadSchema,
  markPayloadSchema,
  PUBLIC_ROOMS_CHANNEL,
  roomChannel,
  ServerEvents,
  userChannel,
  type Ack,
  type MemberLeftReason,
} from '../contracts';
import type { AuthUser } from '../core/auth/jwt-verifier';
import { JwtVerifier } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { ProfilesService } from '../profiles/profiles.service';
import { RoomsService } from '../rooms/rooms.service';
import { GameRunner } from './game-runner.service';
import { GamesService } from './games.service';
import { MembershipService } from './membership.service';
import { PresenceService } from './presence.service';
import { RateLimiter } from './rate-limiter';
import { RealtimePublisher } from './realtime-publisher';
import { SnapshotService } from './snapshot.service';

interface SocketData {
  user: AuthUser;
  roomCode?: string;
}
type AnyEvents = { [event: string]: (...args: unknown[]) => void };
type GameSocket = Socket<AnyEvents, AnyEvents, AnyEvents, SocketData>;
type Limit = 'default' | 'claim';

const LIMITS: Record<
  Limit,
  { suffix: string; limit: number; windowMs: number }
> = {
  default: { suffix: '', limit: 10, windowMs: 1_000 },
  claim: { suffix: ':claim', limit: 1, windowMs: 2_000 },
};

@WebSocketGateway({ namespace: '/game' })
export class GameGateway
  implements OnGatewayInit<Namespace>, OnGatewayDisconnect<GameSocket>
{
  private readonly logger = new Logger(GameGateway.name);
  private readonly limiter = new RateLimiter();

  constructor(
    private readonly verifier: JwtVerifier,
    private readonly profiles: ProfilesService,
    private readonly rooms: RoomsService,
    private readonly membership: MembershipService,
    private readonly games: GamesService,
    private readonly snapshots: SnapshotService,
    private readonly presence: PresenceService,
    private readonly publisher: RealtimePublisher,
    private readonly runner: GameRunner,
  ) {}

  afterInit(server: Namespace): void {
    this.publisher.attach(server);
    this.presence.setExpiryHandler((code, userId) => {
      this.removeMember(code, userId, 'expired').catch((error: unknown) =>
        this.logger.error(error),
      );
    });
    server.use((socket, next) => {
      const token: unknown = socket.handshake.auth?.token;
      if (typeof token !== 'string') return next(new Error('UNAUTHENTICATED'));
      this.verifier
        .verify(token)
        .then(async (user) => {
          await this.profiles.ensure(user);
          (socket.data as SocketData).user = user;
          await socket.join(userChannel(user.id));
          next();
        })
        .catch(() => next(new Error('UNAUTHENTICATED')));
    });
  }

  handleDisconnect(socket: GameSocket): void {
    this.limiter.forget(socket.id);
    const code = socket.data.roomCode;
    const user = socket.data.user;
    if (!code || !user) return;
    if (this.presence.disconnect(code, user.id, socket.id).offline) {
      this.publisher.toRoom(code, ServerEvents.MEMBER_LEFT, {
        userId: user.id,
        reason: 'disconnected',
      });
    }
  }

  @SubscribeMessage(ClientEvents.ROOMS_WATCH)
  onWatch(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      emptyPayloadSchema,
      body,
      async () => {
        await socket.join(PUBLIC_ROOMS_CHANNEL);
        return this.rooms.listPublic();
      },
    );
  }

  @SubscribeMessage(ClientEvents.ROOM_JOIN)
  onJoin(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      joinRoomPayloadSchema,
      body,
      async (user, { code }) => {
        if (socket.data.roomCode && socket.data.roomCode !== code) {
          throw new DomainError(
            'INVALID_STATE',
            'Saia da sala atual antes de entrar em outra',
          );
        }
        await this.membership.join(code, user.id);
        socket.data.roomCode = code;
        await socket.join(roomChannel(code));
        const { firstSocket, reconnected } = this.presence.connect(
          code,
          user.id,
          socket.id,
        );
        const snapshot = await this.snapshots.build(code, user.id);
        if (firstSocket) {
          const member = snapshot.members.find((m) => m.userId === user.id);
          if (member)
            socket
              .to(roomChannel(code))
              .emit(ServerEvents.MEMBER_JOINED, { member, reconnected });
          this.publisher.publicRoomsChanged();
        }
        return snapshot;
      },
    );
  }

  @SubscribeMessage(ClientEvents.ROOM_LEAVE)
  onLeave(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      emptyPayloadSchema,
      body,
      async (user) => {
        const code = this.requireRoom(socket);
        await this.removeMember(code, user.id, 'left');
        await socket.leave(roomChannel(code));
        socket.data.roomCode = undefined;
        return null;
      },
    );
  }

  @SubscribeMessage(ClientEvents.ROOM_KICK)
  onKick(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      kickPayloadSchema,
      body,
      async (user, { userId }) => {
        const code = this.requireRoom(socket);
        await this.membership.kick(code, user.id, userId);
        this.presence.remove(code, userId);
        this.publisher.toRoom(code, ServerEvents.MEMBER_LEFT, {
          userId,
          reason: 'kicked',
        });
        this.publisher.removeUserFromRoom(userId, code);
        this.publisher.publicRoomsChanged();
        return null;
      },
    );
  }

  @SubscribeMessage(ClientEvents.ROOM_CANCEL)
  onCancel(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      emptyPayloadSchema,
      body,
      async (user) => {
        const code = this.requireRoom(socket);
        await this.membership.cancel(code, user.id);
        this.publisher.toRoom(code, ServerEvents.ROOM_CLOSED, {
          reason: 'host_cancelled',
        });
        this.publisher.closeRoomChannel(code);
        this.presence.clearRoom(code);
        this.publisher.publicRoomsChanged();
        return null;
      },
    );
  }

  @SubscribeMessage(ClientEvents.CARD_GENERATE)
  onGenerate(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      emptyPayloadSchema,
      body,
      async (user) => {
        const code = this.requireRoom(socket);
        const card = await this.membership.generateCard(code, user.id);
        this.publisher.toRoom(code, ServerEvents.MEMBER_READY, {
          userId: user.id,
        });
        return card;
      },
    );
  }

  @SubscribeMessage(ClientEvents.GAME_START)
  onStart(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      emptyPayloadSchema,
      body,
      async (user) => {
        await this.runner.start(this.requireRoom(socket), user.id);
        return null;
      },
    );
  }

  @SubscribeMessage(ClientEvents.CARD_MARK)
  onMark(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      markPayloadSchema,
      body,
      async (user, { index }) => ({
        marked: await this.games.mark(this.requireRoom(socket), user.id, index),
      }),
    );
  }

  @SubscribeMessage(ClientEvents.BINGO_CLAIM)
  onClaim(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'claim',
      emptyPayloadSchema,
      body,
      async (user) => {
        const code = this.requireRoom(socket);
        const { gameId, winner } = await this.games.claim(code, user);
        this.runner.stop(gameId);
        this.publisher.toRoom(code, ServerEvents.GAME_WON, winner);
        this.publisher.publicRoomsChanged();
        return winner;
      },
    );
  }

  @SubscribeMessage(ClientEvents.GAME_REPLAY)
  onReplay(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      emptyPayloadSchema,
      body,
      async (user) => {
        const code = this.requireRoom(socket);
        const room = await this.membership.assertHost(code, user.id);
        if (room.status !== 'WAITING')
          throw new DomainError(
            'INVALID_STATE',
            'A partida ainda não terminou',
          );
        await this.runner.broadcastSnapshots(code);
        return null;
      },
    );
  }

  private async removeMember(
    code: string,
    userId: string,
    reason: MemberLeftReason,
  ): Promise<void> {
    const result = await this.membership.leave(code, userId);
    if (!result.removed) return;
    this.presence.remove(code, userId);
    this.publisher.toRoom(code, ServerEvents.MEMBER_LEFT, { userId, reason });
    if (result.newHostId)
      this.publisher.toRoom(code, ServerEvents.HOST_CHANGED, {
        hostId: result.newHostId,
      });
    if (result.closed) {
      this.publisher.toRoom(code, ServerEvents.ROOM_CLOSED, {
        reason: 'empty',
      });
      this.presence.clearRoom(code);
    }
    this.publisher.publicRoomsChanged();
  }

  private requireRoom(socket: GameSocket): string {
    const code = socket.data.roomCode;
    if (!code)
      throw new DomainError('NOT_IN_ROOM', 'Você não está em uma sala');
    return code;
  }

  private async handle<S extends z.ZodType, R>(
    socket: GameSocket,
    limit: Limit,
    schema: S,
    body: unknown,
    fn: (user: AuthUser, payload: z.infer<S>) => Promise<R>,
  ): Promise<Ack<R>> {
    const rule = LIMITS[limit];
    if (
      !this.limiter.allow(socket.id + rule.suffix, rule.limit, rule.windowMs)
    ) {
      return {
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Calma! Muitas ações seguidas',
        },
      };
    }
    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success)
      return {
        ok: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Dados inválidos' },
      };
    try {
      return { ok: true, data: await fn(socket.data.user, parsed.data) };
    } catch (error) {
      if (error instanceof DomainError)
        return {
          ok: false,
          error: { code: error.code, message: error.message },
        };
      this.logger.error(error);
      return {
        ok: false,
        error: { code: 'INTERNAL', message: 'Erro interno' },
      };
    }
  }
}

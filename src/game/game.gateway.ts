import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import * as Sentry from '@sentry/nestjs';
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
  /** Sala sendo reivindicada por um room:join em andamento neste socket, antes do membership.join() resolver. */
  joiningCode?: string;
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
      this.removeMember(code, userId, 'expired').catch((error: unknown) => {
        this.logger.error(error);
        Sentry.captureException(error);
      });
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
        const active = this.currentRoom(socket) ?? socket.data.joiningCode;
        if (active && active !== code) {
          throw new DomainError(
            'INVALID_STATE',
            'Saia da sala atual antes de entrar em outra',
          );
        }
        // Reivindica a sala sincronamente, antes de qualquer await: se uma
        // segunda chamada de room:join chegar neste mesmo socket para um
        // código diferente enquanto este membership.join() ainda está
        // pendente, ela vai ver o claim acima e ser rejeitada — sem isso,
        // as duas passariam pela checagem antes que qualquer uma resolvesse,
        // deixando o usuário membro de duas salas ao mesmo tempo.
        socket.data.joiningCode = code;
        try {
          await this.membership.join(code, user.id);
          if (!socket.connected) {
            // O socket desconectou enquanto membership.join() estava
            // pendente. handleDisconnect já rodou (e não fez nada, pois
            // roomCode ainda não estava setado) e não vai rodar de novo
            // para este socket. O membership.join() acima já pode ter
            // criado um RoomMember de verdade no banco — em vez de deixar
            // esse membro "fantasma" sem presença e sem timer de expiração,
            // arma a janela de graça agora (vira no-op se já houver
            // presença, ex.: outro socket do mesmo usuário ainda conectado).
            this.presence.armOffline(code, user.id);
            throw new DomainError(
              'NOT_IN_ROOM',
              'Conexão perdida durante a entrada na sala',
            );
          }
          await socket.join(roomChannel(code));
          socket.data.roomCode = code;
          const { firstSocket, reconnected } = this.presence.connect(
            code,
            user.id,
            socket.id,
          );
          if (reconnected)
            this.logger.log({
              event: 'presence_reconnected',
              roomCode: code,
              userId: user.id,
            });
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
        } finally {
          socket.data.joiningCode = undefined;
        }
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
        const result = await this.membership.kick(code, user.id, userId);
        this.presence.remove(code, userId);
        this.publisher.toRoom(code, ServerEvents.MEMBER_LEFT, {
          userId,
          reason: 'kicked',
        });
        this.publisher.removeUserFromRoom(userId, code);
        this.publisher.publicRoomsChanged();
        if (result.removed && !result.closed) await this.endIfAbandoned(code);
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
        let claimed: Awaited<ReturnType<GamesService['claim']>>;
        try {
          claimed = await this.games.claim(code, user);
        } catch (error) {
          if (error instanceof DomainError && error.code === 'BINGO_INVALID')
            this.logger.warn({
              event: 'bingo_rejected',
              roomCode: code,
              userId: user.id,
            });
          throw error;
        }
        const { gameId, winner } = claimed;
        this.logger.log({
          event: 'bingo_won',
          roomCode: code,
          gameId,
          userId: user.id,
        });
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
    if (!result.closed) await this.endIfAbandoned(code);
  }

  /** Sem ninguém com cartela (só espectadores), a partida acaba agora em vez de sortear até a 75ª bola. */
  private async endIfAbandoned(code: string): Promise<void> {
    const gameId = await this.games.endIfNoPlayers(code);
    if (!gameId) return;
    this.runner.stop(gameId);
    this.logger.log({ event: 'game_abandoned', roomCode: code, gameId });
    this.publisher.toRoom(code, ServerEvents.GAME_ENDED, {
      reason: 'no_players',
    });
    this.publisher.publicRoomsChanged();
  }

  /**
   * Lê a sala atual do socket, mas não confia apenas na string guardada:
   * confirma que o socket ainda está de fato no canal da sala. Depois de
   * room:cancel ou room:kick, o socket é removido do canal (ver
   * RealtimePublisher.closeRoomChannel/removeUserFromRoom) mas nada limpa
   * socket.data.roomCode diretamente — sem essa checagem, o socket ficaria
   * travado achando que ainda está numa sala já fechada/da qual foi
   * removido, e um room:join para uma sala NOVA seria indevidamente
   * rejeitado com INVALID_STATE até um room:leave redundante.
   */
  private currentRoom(socket: GameSocket): string | undefined {
    const code = socket.data.roomCode;
    if (code && !socket.rooms.has(roomChannel(code))) {
      socket.data.roomCode = undefined;
      return undefined;
    }
    return code;
  }

  private requireRoom(socket: GameSocket): string {
    const code = this.currentRoom(socket);
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
      Sentry.captureException(error);
      return {
        ok: false,
        error: { code: 'INTERNAL', message: 'Erro interno' },
      };
    }
  }
}

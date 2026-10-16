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
  SNAKE_NAMESPACE,
  SNAKE_PUBLIC_ROOMS_CHANNEL,
  SnakeClientEvents,
  roomChannel,
  snakeCreateSchema,
  snakeEmptySchema,
  snakeInputSchema,
  snakeJoinSchema,
  snakePlaySchema,
  snakeViewSchema,
  snakeVisibilitySchema,
  type Ack,
  type SnakeSnapshot,
} from '../contracts';
import { JwtVerifier, type AuthUser } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { RateLimiter } from '../game/rate-limiter';
import { ProfilesService } from '../profiles/profiles.service';
import { SocketSnakePublisher } from './snake-publisher';
import { SnakeRoomsService, type SnakePlayer } from './snake-rooms.service';

interface SocketData {
  user: AuthUser;
  /** null until the profile has a nickname. */
  player: SnakePlayer | null;
}
type AnyEvents = { [event: string]: (...args: unknown[]) => void };
type SnakeSocket = Socket<AnyEvents, AnyEvents, AnyEvents, SocketData>;
type AckError = Extract<Ack<never>, { ok: false }>;
interface Rule {
  suffix: string;
  limit: number;
  windowMs: number;
}

const ACTION_LIMIT: Rule = { suffix: '', limit: 10, windowMs: 1_000 };
const CREATE_LIMIT: Rule = { suffix: ':create', limit: 3, windowMs: 10_000 };
/** Steering is sent up to ~30/s; this leaves room for jitter bursts. */
const INPUT_LIMIT: Rule = { suffix: ':input', limit: 60, windowMs: 1_000 };
const VIEW_LIMIT: Rule = { suffix: ':view', limit: 10, windowMs: 1_000 };

/**
 * Transport only: authenticates the socket, validates every payload with Zod,
 * rate limits and delegates to SnakeRoomsService, the single authority over rooms.
 */
@WebSocketGateway({ namespace: SNAKE_NAMESPACE })
export class SnakeGateway
  implements OnGatewayInit<Namespace>, OnGatewayDisconnect<SnakeSocket>
{
  private readonly logger = new Logger(SnakeGateway.name);
  private readonly limiter = new RateLimiter();

  constructor(
    private readonly verifier: JwtVerifier,
    private readonly profiles: ProfilesService,
    private readonly rooms: SnakeRoomsService,
    private readonly publisher: SocketSnakePublisher,
  ) {}

  afterInit(server: Namespace): void {
    this.publisher.attach(server);
    server.use((socket, next) => {
      const token: unknown = socket.handshake.auth?.token;
      if (typeof token !== 'string') return next(new Error('UNAUTHENTICATED'));
      this.verifier
        .verify(token)
        .then(async (user) => {
          const profile = await this.profiles.ensure(user);
          const data = socket.data as SocketData;
          data.user = user;
          data.player = profile.nickname
            ? {
                userId: user.id,
                nickname: profile.nickname,
                character: profile.character,
              }
            : null;
          next();
        })
        .catch(() => next(new Error('UNAUTHENTICATED')));
    });
  }

  handleDisconnect(socket: SnakeSocket): void {
    this.limiter.forget(socket.id);
    const user = socket.data.user;
    if (user) this.rooms.disconnect(user.id, socket.id);
  }

  @SubscribeMessage(SnakeClientEvents.CREATE)
  onCreate(
    @ConnectedSocket() socket: SnakeSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      CREATE_LIMIT,
      snakeCreateSchema,
      body,
      async (_, { isPublic }) => {
        const snapshot = this.rooms.create(
          this.player(socket),
          socket.id,
          isPublic,
        );
        await socket.join(roomChannel(snapshot.state.code));
        this.logger.log({
          event: 'snake_room_created',
          roomCode: snapshot.state.code,
        });
        return snapshot;
      },
    );
  }

  /** Lobby screen: current public rooms now, then `snake:rooms_updated` on every change. */
  @SubscribeMessage(SnakeClientEvents.WATCH_ROOMS)
  onWatchRooms(
    @ConnectedSocket() socket: SnakeSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      ACTION_LIMIT,
      snakeEmptySchema,
      body,
      async () => {
        await socket.join(SNAKE_PUBLIC_ROOMS_CHANNEL);
        return this.rooms.listPublic();
      },
    );
  }

  @SubscribeMessage(SnakeClientEvents.UNWATCH_ROOMS)
  onUnwatchRooms(
    @ConnectedSocket() socket: SnakeSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      ACTION_LIMIT,
      snakeEmptySchema,
      body,
      async () => {
        await socket.leave(SNAKE_PUBLIC_ROOMS_CHANNEL);
        return null;
      },
    );
  }

  @SubscribeMessage(SnakeClientEvents.JOIN)
  onJoin(@ConnectedSocket() socket: SnakeSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      ACTION_LIMIT,
      snakeJoinSchema,
      body,
      async (_, { code }): Promise<SnakeSnapshot> => {
        const snapshot = this.rooms.join(code, this.player(socket), socket.id);
        await socket.join(roomChannel(code));
        return snapshot;
      },
    );
  }

  @SubscribeMessage(SnakeClientEvents.SET_VISIBILITY)
  onSetVisibility(
    @ConnectedSocket() socket: SnakeSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      ACTION_LIMIT,
      snakeVisibilitySchema,
      body,
      (user, { isPublic }) => {
        this.rooms.setVisibility(user.id, isPublic);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(SnakeClientEvents.PLAY)
  onPlay(@ConnectedSocket() socket: SnakeSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      ACTION_LIMIT,
      snakePlaySchema,
      body,
      (user, { skin }) => Promise.resolve(this.rooms.play(user.id, skin)),
    );
  }

  @SubscribeMessage(SnakeClientEvents.LEAVE)
  onLeave(
    @ConnectedSocket() socket: SnakeSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      ACTION_LIMIT,
      snakeEmptySchema,
      body,
      async (user) => {
        const code = this.rooms.leave(user.id);
        await socket.leave(roomChannel(code));
        return null;
      },
    );
  }

  /** Hot path: no ack, invalid or excess inputs are dropped silently. */
  @SubscribeMessage(SnakeClientEvents.INPUT)
  onInput(
    @ConnectedSocket() socket: SnakeSocket,
    @MessageBody() body: unknown,
  ) {
    if (!this.allow(socket, INPUT_LIMIT)) return;
    const parsed = snakeInputSchema.safeParse(body);
    if (parsed.success) this.rooms.input(socket.data.user.id, parsed.data);
  }

  @SubscribeMessage(SnakeClientEvents.VIEW)
  onView(@ConnectedSocket() socket: SnakeSocket, @MessageBody() body: unknown) {
    if (!this.allow(socket, VIEW_LIMIT)) return;
    const parsed = snakeViewSchema.safeParse(body);
    if (parsed.success)
      this.rooms.view(socket.data.user.id, parsed.data.w, parsed.data.h);
  }

  private allow(socket: SnakeSocket, rule: Rule): boolean {
    return this.limiter.allow(
      socket.id + rule.suffix,
      rule.limit,
      rule.windowMs,
    );
  }

  private player(socket: SnakeSocket): SnakePlayer {
    const player = socket.data.player;
    if (!player)
      throw new DomainError(
        'NICKNAME_REQUIRED',
        'Escolha um apelido antes de jogar',
      );
    return player;
  }

  private async handle<S extends z.ZodType, R>(
    socket: SnakeSocket,
    rule: Rule,
    schema: S,
    body: unknown,
    fn: (user: AuthUser, payload: z.infer<S>) => Promise<R>,
  ): Promise<Ack<R>> {
    if (!this.allow(socket, rule))
      return {
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Calma! Muitas ações seguidas',
        },
      };
    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success)
      return {
        ok: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Dados inválidos' },
      };
    try {
      return { ok: true, data: await fn(socket.data.user, parsed.data) };
    } catch (error) {
      return this.toError(error);
    }
  }

  private toError(error: unknown): AckError {
    if (error instanceof DomainError)
      return { ok: false, error: { code: error.code, message: error.message } };
    this.logger.error(error);
    Sentry.captureException(error);
    return { ok: false, error: { code: 'INTERNAL', message: 'Erro interno' } };
  }
}

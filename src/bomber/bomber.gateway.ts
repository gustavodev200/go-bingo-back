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
  BOMBER_NAMESPACE,
  BOMBER_PUBLIC_ROOMS_CHANNEL,
  BomberClientEvents,
  bomberColorSchema,
  bomberCreateSchema,
  bomberEmptySchema,
  bomberInputSchema,
  bomberJoinSchema,
  bomberReadySchema,
  bomberRemoveBotSchema,
  bomberSetRulesSchema,
  bomberVisibilitySchema,
  roomChannel,
  userChannel,
  type Ack,
  type BomberSnapshot,
} from '../contracts';
import { JwtVerifier, type AuthUser } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { RateLimiter } from '../game/rate-limiter';
import { ProfilesService } from '../profiles/profiles.service';
import { SocketBomberPublisher } from './bomber-publisher';
import { BomberRoomsService, type BomberPlayer } from './bomber-rooms.service';

interface SocketData {
  user: AuthUser;
  /** null until the profile has a nickname. */
  player: BomberPlayer | null;
}
type AnyEvents = { [event: string]: (...args: unknown[]) => void };
type BomberSocket = Socket<AnyEvents, AnyEvents, AnyEvents, SocketData>;
type Limit = 'default' | 'create';
type AckError = Extract<Ack<never>, { ok: false }>;

const LIMITS: Record<
  Limit,
  { suffix: string; limit: number; windowMs: number }
> = {
  default: { suffix: '', limit: 10, windowMs: 1_000 },
  create: { suffix: ':create', limit: 3, windowMs: 10_000 },
};
/** Inputs arrive at the tick rate (30/s); this leaves room for jitter bursts. */
const INPUT_LIMIT = { suffix: ':input', limit: 60, windowMs: 1_000 };

/**
 * Transport only: authenticates the socket, validates every payload with Zod,
 * rate limits and delegates to BomberRoomsService, the single authority over rooms.
 */
@WebSocketGateway({ namespace: BOMBER_NAMESPACE })
export class BomberGateway
  implements OnGatewayInit<Namespace>, OnGatewayDisconnect<BomberSocket>
{
  private readonly logger = new Logger(BomberGateway.name);
  private readonly limiter = new RateLimiter();

  constructor(
    private readonly verifier: JwtVerifier,
    private readonly profiles: ProfilesService,
    private readonly rooms: BomberRoomsService,
    private readonly publisher: SocketBomberPublisher,
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
          await socket.join(userChannel(user.id));
          next();
        })
        .catch(() => next(new Error('UNAUTHENTICATED')));
    });
  }

  handleDisconnect(socket: BomberSocket): void {
    this.limiter.forget(socket.id);
    const user = socket.data.user;
    if (user) this.rooms.disconnect(user.id, socket.id);
  }

  @SubscribeMessage(BomberClientEvents.CREATE)
  onCreate(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'create',
      bomberCreateSchema,
      body,
      async (_, { isPublic }) => {
        const snapshot = this.rooms.create(
          this.player(socket),
          socket.id,
          isPublic,
        );
        await socket.join(roomChannel(snapshot.state.code));
        this.logger.log({
          event: 'bomber_room_created',
          roomCode: snapshot.state.code,
        });
        return snapshot;
      },
    );
  }

  /** Lobby screen: current public rooms now, then `bomber:rooms_updated` on every change. */
  @SubscribeMessage(BomberClientEvents.WATCH_ROOMS)
  onWatchRooms(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', bomberEmptySchema, body, async () => {
      await socket.join(BOMBER_PUBLIC_ROOMS_CHANNEL);
      return this.rooms.listPublic();
    });
  }

  @SubscribeMessage(BomberClientEvents.UNWATCH_ROOMS)
  onUnwatchRooms(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', bomberEmptySchema, body, async () => {
      await socket.leave(BOMBER_PUBLIC_ROOMS_CHANNEL);
      return null;
    });
  }

  @SubscribeMessage(BomberClientEvents.SET_VISIBILITY)
  onSetVisibility(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      bomberVisibilitySchema,
      body,
      (user, { isPublic }) =>
        this.run(() => this.rooms.setVisibility(user.id, isPublic)),
    );
  }

  @SubscribeMessage(BomberClientEvents.SET_RULES)
  onSetRules(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      bomberSetRulesSchema,
      body,
      (user, { rules }) => this.run(() => this.rooms.setRules(user.id, rules)),
    );
  }

  @SubscribeMessage(BomberClientEvents.JOIN)
  onJoin(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      bomberJoinSchema,
      body,
      async (_, { code }): Promise<BomberSnapshot> => {
        const snapshot = this.rooms.join(code, this.player(socket), socket.id);
        await socket.join(roomChannel(code));
        return snapshot;
      },
    );
  }

  @SubscribeMessage(BomberClientEvents.SYNC)
  onSync(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', bomberEmptySchema, body, (user) =>
      Promise.resolve(this.rooms.sync(user.id)),
    );
  }

  @SubscribeMessage(BomberClientEvents.LEAVE)
  onLeave(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', bomberEmptySchema, body, (user) =>
      this.run(() => this.rooms.leave(user.id)),
    );
  }

  @SubscribeMessage(BomberClientEvents.READY)
  onReady(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      bomberReadySchema,
      body,
      (user, { ready }) => this.run(() => this.rooms.setReady(user.id, ready)),
    );
  }

  @SubscribeMessage(BomberClientEvents.SET_COLOR)
  onSetColor(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      bomberColorSchema,
      body,
      (user, { color }) => this.run(() => this.rooms.setColor(user.id, color)),
    );
  }

  @SubscribeMessage(BomberClientEvents.ADD_BOT)
  onAddBot(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', bomberEmptySchema, body, (user) =>
      this.run(() => this.rooms.addBot(user.id)),
    );
  }

  @SubscribeMessage(BomberClientEvents.REMOVE_BOT)
  onRemoveBot(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      bomberRemoveBotSchema,
      body,
      (user, { seat }) => this.run(() => this.rooms.removeBot(user.id, seat)),
    );
  }

  @SubscribeMessage(BomberClientEvents.START)
  onStart(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', bomberEmptySchema, body, (user) =>
      this.run(() => {
        this.rooms.start(user.id);
        this.logger.log({
          event: 'bomber_match_started',
          roomCode: this.rooms.roomOf(user.id),
        });
      }),
    );
  }

  @SubscribeMessage(BomberClientEvents.REMATCH)
  onRematch(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', bomberEmptySchema, body, (user) =>
      this.run(() => this.rooms.rematch(user.id)),
    );
  }

  /** Hot path: no ack, invalid or excess inputs are dropped silently. */
  @SubscribeMessage(BomberClientEvents.INPUT)
  onInput(
    @ConnectedSocket() socket: BomberSocket,
    @MessageBody() body: unknown,
  ) {
    const user = socket.data.user;
    if (
      !this.limiter.allow(
        socket.id + INPUT_LIMIT.suffix,
        INPUT_LIMIT.limit,
        INPUT_LIMIT.windowMs,
      )
    )
      return;
    const parsed = bomberInputSchema.safeParse(body);
    if (parsed.success) this.rooms.input(user.id, parsed.data);
  }

  private player(socket: BomberSocket): BomberPlayer {
    const player = socket.data.player;
    if (!player)
      throw new DomainError(
        'NICKNAME_REQUIRED',
        'Escolha um apelido antes de jogar',
      );
    return player;
  }

  private run(fn: () => unknown): Promise<null> {
    fn();
    return Promise.resolve(null);
  }

  private async handle<S extends z.ZodType, R>(
    socket: BomberSocket,
    limit: Limit,
    schema: S,
    body: unknown,
    fn: (user: AuthUser, payload: z.infer<S>) => Promise<R>,
  ): Promise<Ack<R>> {
    const rule = LIMITS[limit];
    if (!this.limiter.allow(socket.id + rule.suffix, rule.limit, rule.windowMs))
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

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
  INF_NAMESPACE,
  INF_PUBLIC_ROOMS_CHANNEL,
  InfClientEvents,
  infColorSchema,
  infCreateSchema,
  infEmptySchema,
  infInputSchema,
  infActSchema,
  infChatSchema,
  infJoinSchema,
  infReadySchema,
  infRemoveBotSchema,
  infSetRulesSchema,
  infVisibilitySchema,
  roomChannel,
  userChannel,
  type Ack,
  type InfSnapshot,
} from '../contracts';
import { JwtVerifier, type AuthUser } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { RateLimiter } from '../game/rate-limiter';
import { ProfilesService } from '../profiles/profiles.service';
import { SocketInfPublisher } from './infiltrado-publisher';
import { InfRoomsService, type InfPlayer } from './infiltrado-rooms.service';

interface SocketData {
  user: AuthUser;
  /** null until the profile has a nickname. */
  player: InfPlayer | null;
}
type AnyEvents = { [event: string]: (...args: unknown[]) => void };
type InfSocket = Socket<AnyEvents, AnyEvents, AnyEvents, SocketData>;
type Limit = 'default' | 'create' | 'chat';
type AckError = Extract<Ack<never>, { ok: false }>;

const LIMITS: Record<
  Limit,
  { suffix: string; limit: number; windowMs: number }
> = {
  default: { suffix: '', limit: 10, windowMs: 1_000 },
  create: { suffix: ':create', limit: 3, windowMs: 10_000 },
  chat: { suffix: ':chat', limit: 4, windowMs: 3_000 },
};
/** Inputs arrive at the tick rate (20/s); this leaves room for jitter bursts. */
const INPUT_LIMIT = { suffix: ':input', limit: 60, windowMs: 1_000 };

/**
 * Transport only: authenticates the socket, validates every payload with Zod,
 * rate limits and delegates to InfRoomsService, the single authority over rooms.
 */
@WebSocketGateway({ namespace: INF_NAMESPACE })
export class InfGateway
  implements OnGatewayInit<Namespace>, OnGatewayDisconnect<InfSocket>
{
  private readonly logger = new Logger(InfGateway.name);
  private readonly limiter = new RateLimiter();

  constructor(
    private readonly verifier: JwtVerifier,
    private readonly profiles: ProfilesService,
    private readonly rooms: InfRoomsService,
    private readonly publisher: SocketInfPublisher,
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

  handleDisconnect(socket: InfSocket): void {
    this.limiter.forget(socket.id);
    const user = socket.data.user;
    if (user) this.rooms.disconnect(user.id, socket.id);
  }

  @SubscribeMessage(InfClientEvents.CREATE)
  onCreate(@ConnectedSocket() socket: InfSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'create',
      infCreateSchema,
      body,
      async (_, { isPublic }) => {
        const snapshot = this.rooms.create(
          this.player(socket),
          socket.id,
          isPublic,
        );
        await socket.join(roomChannel(snapshot.state.code));
        this.logger.log({
          event: 'infiltrado_room_created',
          roomCode: snapshot.state.code,
        });
        return snapshot;
      },
    );
  }

  /** Lobby screen: current public rooms now, then `inf:rooms_updated` on every change. */
  @SubscribeMessage(InfClientEvents.WATCH_ROOMS)
  onWatchRooms(
    @ConnectedSocket() socket: InfSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', infEmptySchema, body, async () => {
      await socket.join(INF_PUBLIC_ROOMS_CHANNEL);
      return this.rooms.listPublic();
    });
  }

  @SubscribeMessage(InfClientEvents.UNWATCH_ROOMS)
  onUnwatchRooms(
    @ConnectedSocket() socket: InfSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', infEmptySchema, body, async () => {
      await socket.leave(INF_PUBLIC_ROOMS_CHANNEL);
      return null;
    });
  }

  @SubscribeMessage(InfClientEvents.SET_VISIBILITY)
  onSetVisibility(
    @ConnectedSocket() socket: InfSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      infVisibilitySchema,
      body,
      (user, { isPublic }) =>
        this.run(() => this.rooms.setVisibility(user.id, isPublic)),
    );
  }

  @SubscribeMessage(InfClientEvents.SET_RULES)
  onSetRules(
    @ConnectedSocket() socket: InfSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      infSetRulesSchema,
      body,
      (user, { rules }) => this.run(() => this.rooms.setRules(user.id, rules)),
    );
  }

  @SubscribeMessage(InfClientEvents.JOIN)
  onJoin(@ConnectedSocket() socket: InfSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      infJoinSchema,
      body,
      async (_, { code }): Promise<InfSnapshot> => {
        const snapshot = this.rooms.join(code, this.player(socket), socket.id);
        await socket.join(roomChannel(code));
        return snapshot;
      },
    );
  }

  @SubscribeMessage(InfClientEvents.SYNC)
  onSync(@ConnectedSocket() socket: InfSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', infEmptySchema, body, (user) =>
      Promise.resolve(this.rooms.sync(user.id)),
    );
  }

  @SubscribeMessage(InfClientEvents.LEAVE)
  onLeave(@ConnectedSocket() socket: InfSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', infEmptySchema, body, (user) =>
      this.run(() => this.rooms.leave(user.id)),
    );
  }

  @SubscribeMessage(InfClientEvents.READY)
  onReady(@ConnectedSocket() socket: InfSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      infReadySchema,
      body,
      (user, { ready }) => this.run(() => this.rooms.setReady(user.id, ready)),
    );
  }

  @SubscribeMessage(InfClientEvents.SET_COLOR)
  onSetColor(
    @ConnectedSocket() socket: InfSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      infColorSchema,
      body,
      (user, { color }) => this.run(() => this.rooms.setColor(user.id, color)),
    );
  }

  @SubscribeMessage(InfClientEvents.ADD_BOT)
  onAddBot(@ConnectedSocket() socket: InfSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', infEmptySchema, body, (user) =>
      this.run(() => this.rooms.addBot(user.id)),
    );
  }

  @SubscribeMessage(InfClientEvents.REMOVE_BOT)
  onRemoveBot(
    @ConnectedSocket() socket: InfSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      infRemoveBotSchema,
      body,
      (user, { seat }) => this.run(() => this.rooms.removeBot(user.id, seat)),
    );
  }

  @SubscribeMessage(InfClientEvents.START)
  onStart(@ConnectedSocket() socket: InfSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', infEmptySchema, body, (user) =>
      this.run(() => {
        this.rooms.start(user.id);
        this.logger.log({
          event: 'infiltrado_match_started',
          roomCode: this.rooms.roomOf(user.id),
        });
      }),
    );
  }

  @SubscribeMessage(InfClientEvents.REMATCH)
  onRematch(
    @ConnectedSocket() socket: InfSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', infEmptySchema, body, (user) =>
      this.run(() => this.rooms.rematch(user.id)),
    );
  }

  /** Use, kill, report, vote...: the match validates distance, role and phase. */
  @SubscribeMessage(InfClientEvents.ACT)
  onAct(@ConnectedSocket() socket: InfSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', infActSchema, body, (user, action) =>
      this.run(() => this.rooms.act(user.id, action)),
    );
  }

  @SubscribeMessage(InfClientEvents.CHAT)
  onChat(@ConnectedSocket() socket: InfSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'chat', infChatSchema, body, (user, { text }) =>
      this.run(() => this.rooms.chat(user.id, text)),
    );
  }

  /** Hot path: no ack, invalid or excess inputs are dropped silently. */
  @SubscribeMessage(InfClientEvents.INPUT)
  onInput(@ConnectedSocket() socket: InfSocket, @MessageBody() body: unknown) {
    const user = socket.data.user;
    if (
      !this.limiter.allow(
        socket.id + INPUT_LIMIT.suffix,
        INPUT_LIMIT.limit,
        INPUT_LIMIT.windowMs,
      )
    )
      return;
    const parsed = infInputSchema.safeParse(body);
    if (parsed.success) this.rooms.input(user.id, parsed.data);
  }

  private player(socket: InfSocket): InfPlayer {
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
    socket: InfSocket,
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

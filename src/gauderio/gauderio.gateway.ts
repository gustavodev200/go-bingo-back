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
  roomChannel,
  GAUD_NAMESPACE,
  GAUD_PUBLIC_ROOMS_CHANNEL,
  GaudClientEvents,
  gaudCreateSchema,
  gaudEmptySchema,
  gaudJoinSchema,
  gaudSetSettingsSchema,
  gaudPlayCardSchema,
  gaudReadySchema,
  gaudCallSchema,
  gaudRespondSchema,
  gaudFoldSchema,
  gaudTakeSeatSchema,
  gaudVisibilitySchema,
  userChannel,
  setStakeSchema,
  type Ack,
  type GaudSeat,
  type GaudSnapshot,
} from '../contracts';
import { JwtVerifier, type AuthUser } from '../core/auth/jwt-verifier';
import { ArenaService } from '../arena/arena.service';
import { DomainError } from '../core/domain-error';
import { RateLimiter } from '../game/rate-limiter';
import { ProfilesService } from '../profiles/profiles.service';
import { ActionDeduper } from './action-deduper';
import { SocketGaudPublisher } from './gauderio-publisher';
import { GaudRoomsService, type GaudPlayer } from './gauderio-rooms.service';

interface SocketData {
  user: AuthUser;
  /** null until the profile has a nickname. */
  player: GaudPlayer | null;
}
type AnyEvents = { [event: string]: (...args: unknown[]) => void };
type GaudSocket = Socket<AnyEvents, AnyEvents, AnyEvents, SocketData>;
type Limit = 'default' | 'create';
type AckError = Extract<Ack<never>, { ok: false }>;

const LIMITS: Record<
  Limit,
  { suffix: string; limit: number; windowMs: number }
> = {
  default: { suffix: '', limit: 10, windowMs: 1_000 },
  create: { suffix: ':create', limit: 3, windowMs: 10_000 },
};

/**
 * Transport only: authenticates the socket, validates every payload with Zod,
 * rate limits, deduplicates game actions and delegates to GaudRoomsService,
 * which is the single authority over the tables.
 */
@WebSocketGateway({ namespace: GAUD_NAMESPACE })
export class GaudGateway
  implements OnGatewayInit<Namespace>, OnGatewayDisconnect<GaudSocket>
{
  private readonly logger = new Logger(GaudGateway.name);
  private readonly limiter = new RateLimiter();
  private readonly deduper = new ActionDeduper<Ack<null>>();

  constructor(
    private readonly verifier: JwtVerifier,
    private readonly profiles: ProfilesService,
    private readonly tables: GaudRoomsService,
    private readonly publisher: SocketGaudPublisher,
    private readonly arena: ArenaService,
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

  handleDisconnect(socket: GaudSocket): void {
    this.limiter.forget(socket.id);
    const user = socket.data.user;
    if (user) this.tables.disconnect(user.id, socket.id);
  }

  @SubscribeMessage(GaudClientEvents.CREATE)
  onCreate(
    @ConnectedSocket() socket: GaudSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'create',
      gaudCreateSchema,
      body,
      async (_, { isPublic, settings }) => {
        const snapshot = this.tables.create(
          this.player(socket),
          socket.id,
          isPublic,
          settings,
        );
        await socket.join(roomChannel(snapshot.state.code));
        this.logger.log({
          event: 'gauderio_room_created',
          roomCode: snapshot.state.code,
        });
        return snapshot;
      },
    );
  }

  /** Lobby screen: current public tables now, then `gauderio:rooms_updated` on every change. */
  @SubscribeMessage(GaudClientEvents.WATCH_ROOMS)
  onWatchRooms(
    @ConnectedSocket() socket: GaudSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', gaudEmptySchema, body, async () => {
      await socket.join(GAUD_PUBLIC_ROOMS_CHANNEL);
      return this.tables.listPublic();
    });
  }

  @SubscribeMessage(GaudClientEvents.UNWATCH_ROOMS)
  onUnwatchRooms(
    @ConnectedSocket() socket: GaudSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', gaudEmptySchema, body, async () => {
      await socket.leave(GAUD_PUBLIC_ROOMS_CHANNEL);
      return null;
    });
  }

  @SubscribeMessage(GaudClientEvents.SET_VISIBILITY)
  onSetVisibility(
    @ConnectedSocket() socket: GaudSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      gaudVisibilitySchema,
      body,
      (user, { isPublic }) => {
        this.tables.setVisibility(user.id, isPublic);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(GaudClientEvents.SET_SETTINGS)
  onSetSettings(
    @ConnectedSocket() socket: GaudSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      gaudSetSettingsSchema,
      body,
      (user, { settings }) => {
        this.tables.setSettings(user.id, settings);
        return Promise.resolve(null);
      },
    );
  }

  /** Host only: the bet of the next match. The host must be able to cover it. */
  @SubscribeMessage(GaudClientEvents.SET_STAKE)
  onSetStake(
    @ConnectedSocket() socket: GaudSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      setStakeSchema,
      body,
      async (user, { stake }) => {
        await this.arena.assertStake('GAUDERIO', stake, [user.id]);
        this.tables.setStake(user.id, stake);
        return null;
      },
    );
  }

  @SubscribeMessage(GaudClientEvents.JOIN)
  onJoin(@ConnectedSocket() socket: GaudSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      gaudJoinSchema,
      body,
      async (_, { code }): Promise<GaudSnapshot> => {
        const player = this.player(socket);
        const stake = this.tables.stakeToJoin(code, player.userId);
        if (stake !== null)
          await this.arena.assertStake('GAUDERIO', stake, [player.userId]);
        const snapshot = this.tables.join(code, player, socket.id);
        await socket.join(roomChannel(code));
        return snapshot;
      },
    );
  }

  @SubscribeMessage(GaudClientEvents.SYNC)
  onSync(@ConnectedSocket() socket: GaudSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', gaudEmptySchema, body, (user) =>
      Promise.resolve(this.tables.sync(user.id)),
    );
  }

  @SubscribeMessage(GaudClientEvents.LEAVE)
  onLeave(@ConnectedSocket() socket: GaudSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', gaudEmptySchema, body, (user) => {
      this.tables.leave(user.id);
      return Promise.resolve(null);
    });
  }

  @SubscribeMessage(GaudClientEvents.TAKE_SEAT)
  onTakeSeat(
    @ConnectedSocket() socket: GaudSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      gaudTakeSeatSchema,
      body,
      (user, { seat }) => {
        this.tables.takeSeat(user.id, seat as GaudSeat);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(GaudClientEvents.READY)
  onReady(@ConnectedSocket() socket: GaudSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      gaudReadySchema,
      body,
      (user, { ready }) => {
        this.tables.setReady(user.id, ready);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(GaudClientEvents.START)
  onStart(@ConnectedSocket() socket: GaudSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      gaudEmptySchema,
      body,
      async (user) => {
        const check = this.tables.stakeCheck(user.id);
        await this.arena.assertStake('GAUDERIO', check.stake, check.userIds);
        this.tables.start(user.id);
        this.logger.log({
          event: 'gauderio_match_started',
          roomCode: this.tables.roomOf(user.id),
        });
        return null;
      },
    );
  }

  @SubscribeMessage(GaudClientEvents.REMATCH)
  onRematch(
    @ConnectedSocket() socket: GaudSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', gaudEmptySchema, body, (user) => {
      this.tables.rematch(user.id);
      return Promise.resolve(null);
    });
  }

  @SubscribeMessage(GaudClientEvents.PLAY_CARD)
  onPlayCard(
    @ConnectedSocket() socket: GaudSocket,
    @MessageBody() body: unknown,
  ) {
    return this.action(socket, gaudPlayCardSchema, body, (user, p) =>
      this.tables.playCard(user.id, p.cardId, p.hidden),
    );
  }

  @SubscribeMessage(GaudClientEvents.CALL)
  onCall(@ConnectedSocket() socket: GaudSocket, @MessageBody() body: unknown) {
    return this.action(socket, gaudCallSchema, body, (user, p) =>
      this.tables.call(user.id, p.call),
    );
  }

  @SubscribeMessage(GaudClientEvents.RESPOND)
  onRespond(
    @ConnectedSocket() socket: GaudSocket,
    @MessageBody() body: unknown,
  ) {
    return this.action(socket, gaudRespondSchema, body, (user, p) =>
      this.tables.respond(user.id, p.accept),
    );
  }

  @SubscribeMessage(GaudClientEvents.FOLD)
  onFold(@ConnectedSocket() socket: GaudSocket, @MessageBody() body: unknown) {
    return this.action(socket, gaudFoldSchema, body, (user) =>
      this.tables.fold(user.id),
    );
  }

  private player(socket: GaudSocket): GaudPlayer {
    const player = socket.data.player;
    if (!player)
      throw new DomainError(
        'NICKNAME_REQUIRED',
        'Escolha um apelido antes de jogar',
      );
    return player;
  }

  /** Game moves: same as handle(), plus replay protection by actionId. */
  private action<S extends z.ZodType<{ actionId: string }>>(
    socket: GaudSocket,
    schema: S,
    body: unknown,
    fn: (user: AuthUser, payload: z.infer<S>) => void,
  ): Promise<Ack<null>> {
    return this.handle(socket, 'default', schema, body, (user, payload) =>
      Promise.resolve(
        this.deduper.run(user.id, payload.actionId, () =>
          this.attempt(() => {
            fn(user, payload);
            return null;
          }),
        ),
      ),
    ).then((ack) => (ack.ok ? ack.data : ack));
  }

  private attempt<R>(fn: () => R): Ack<R> {
    try {
      return { ok: true, data: fn() };
    } catch (error) {
      return this.toError(error);
    }
  }

  private async handle<S extends z.ZodType, R>(
    socket: GaudSocket,
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

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
  DOMINO_NAMESPACE,
  DOMINO_PUBLIC_ROOMS_CHANNEL,
  DominoClientEvents,
  dominoCreateSchema,
  dominoEmptySchema,
  dominoJoinSchema,
  dominoActionSchema,
  dominoEmoteSchema,
  dominoPlaySchema,
  dominoSetRulesSchema,
  dominoReadySchema,
  dominoVisibilitySchema,
  userChannel,
  setStakeSchema,
  type Ack,
  type DominoSnapshot,
} from '../contracts';
import { JwtVerifier, type AuthUser } from '../core/auth/jwt-verifier';
import { ArenaService } from '../arena/arena.service';
import { DomainError } from '../core/domain-error';
import { RateLimiter } from '../game/rate-limiter';
import { ProfilesService } from '../profiles/profiles.service';
import { ActionDeduper } from '../truco/action-deduper';
import { SocketDominoPublisher } from './domino-publisher';
import { DominoRoomsService, type DominoPlayer } from './domino-rooms.service';

interface SocketData {
  user: AuthUser;
  /** null until the profile has a nickname. */
  player: DominoPlayer | null;
}
type AnyEvents = { [event: string]: (...args: unknown[]) => void };
type DominoSocket = Socket<AnyEvents, AnyEvents, AnyEvents, SocketData>;
type Limit = 'default' | 'create' | 'emote';
type AckError = Extract<Ack<never>, { ok: false }>;

const LIMITS: Record<
  Limit,
  { suffix: string; limit: number; windowMs: number }
> = {
  default: { suffix: '', limit: 10, windowMs: 1_000 },
  create: { suffix: ':create', limit: 3, windowMs: 10_000 },
  emote: { suffix: ':emote', limit: 1, windowMs: 1_000 },
};

/**
 * Transport only: authenticates the socket, validates every payload with Zod,
 * rate limits, deduplicates game actions and delegates to DominoRoomsService,
 * which is the single authority over the tables.
 */
@WebSocketGateway({ namespace: DOMINO_NAMESPACE })
export class DominoGateway
  implements OnGatewayInit<Namespace>, OnGatewayDisconnect<DominoSocket>
{
  private readonly logger = new Logger(DominoGateway.name);
  private readonly limiter = new RateLimiter();
  private readonly deduper = new ActionDeduper<Ack<null>>();

  constructor(
    private readonly verifier: JwtVerifier,
    private readonly profiles: ProfilesService,
    private readonly tables: DominoRoomsService,
    private readonly publisher: SocketDominoPublisher,
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

  handleDisconnect(socket: DominoSocket): void {
    this.limiter.forget(socket.id);
    const user = socket.data.user;
    if (user) this.tables.disconnect(user.id, socket.id);
  }

  @SubscribeMessage(DominoClientEvents.CREATE)
  onCreate(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'create',
      dominoCreateSchema,
      body,
      async (_, { isPublic }) => {
        const snapshot = this.tables.create(
          this.player(socket),
          socket.id,
          isPublic,
        );
        await socket.join(roomChannel(snapshot.state.code));
        this.logger.log({
          event: 'domino_room_created',
          roomCode: snapshot.state.code,
        });
        return snapshot;
      },
    );
  }

  /** Lobby screen: current public tables now, then `domino:rooms_updated` on every change. */
  @SubscribeMessage(DominoClientEvents.WATCH_ROOMS)
  onWatchRooms(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', dominoEmptySchema, body, async () => {
      await socket.join(DOMINO_PUBLIC_ROOMS_CHANNEL);
      return this.tables.listPublic();
    });
  }

  @SubscribeMessage(DominoClientEvents.UNWATCH_ROOMS)
  onUnwatchRooms(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', dominoEmptySchema, body, async () => {
      await socket.leave(DOMINO_PUBLIC_ROOMS_CHANNEL);
      return null;
    });
  }

  @SubscribeMessage(DominoClientEvents.SET_VISIBILITY)
  onSetVisibility(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      dominoVisibilitySchema,
      body,
      (user, { isPublic }) => {
        this.tables.setVisibility(user.id, isPublic);
        return Promise.resolve(null);
      },
    );
  }

  /** Host only: the bet of the next match. The host must be able to cover it. */
  @SubscribeMessage(DominoClientEvents.SET_STAKE)
  onSetStake(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      setStakeSchema,
      body,
      async (user, { stake }) => {
        await this.arena.assertStake('DOMINO', stake, [user.id]);
        this.tables.setStake(user.id, stake);
        return null;
      },
    );
  }

  @SubscribeMessage(DominoClientEvents.JOIN)
  onJoin(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      dominoJoinSchema,
      body,
      async (_, { code }): Promise<DominoSnapshot> => {
        const player = this.player(socket);
        const stake = this.tables.stakeToJoin(code, player.userId);
        if (stake !== null)
          await this.arena.assertStake('DOMINO', stake, [player.userId]);
        const snapshot = this.tables.join(code, player, socket.id);
        await socket.join(roomChannel(code));
        return snapshot;
      },
    );
  }

  @SubscribeMessage(DominoClientEvents.SYNC)
  onSync(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', dominoEmptySchema, body, (user) =>
      Promise.resolve(this.tables.sync(user.id)),
    );
  }

  @SubscribeMessage(DominoClientEvents.LEAVE)
  onLeave(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', dominoEmptySchema, body, (user) => {
      this.tables.leave(user.id);
      return Promise.resolve(null);
    });
  }

  @SubscribeMessage(DominoClientEvents.SET_RULES)
  onSetRules(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      dominoSetRulesSchema,
      body,
      (user, { rules }) => {
        this.tables.setRules(user.id, rules);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(DominoClientEvents.READY)
  onReady(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      dominoReadySchema,
      body,
      (user, { ready }) => {
        this.tables.setReady(user.id, ready);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(DominoClientEvents.START)
  onStart(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      dominoEmptySchema,
      body,
      async (user) => {
        const check = this.tables.stakeCheck(user.id);
        await this.arena.assertStake('DOMINO', check.stake, check.userIds);
        this.tables.start(user.id);
        this.logger.log({
          event: 'domino_match_started',
          roomCode: this.tables.roomOf(user.id),
        });
        return null;
      },
    );
  }

  @SubscribeMessage(DominoClientEvents.REMATCH)
  onRematch(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', dominoEmptySchema, body, (user) => {
      this.tables.rematch(user.id);
      return Promise.resolve(null);
    });
  }

  @SubscribeMessage(DominoClientEvents.PLAY)
  onPlay(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.action(socket, dominoPlaySchema, body, (user, p) =>
      this.tables.play(user.id, p.tileId, p.side),
    );
  }

  @SubscribeMessage(DominoClientEvents.DRAW)
  onDraw(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.action(socket, dominoActionSchema, body, (user) =>
      this.tables.draw(user.id),
    );
  }

  @SubscribeMessage(DominoClientEvents.EMOTE)
  onEmote(
    @ConnectedSocket() socket: DominoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'emote', dominoEmoteSchema, body, (user, p) => {
      this.tables.emote(user.id, p.emote);
      return Promise.resolve(null);
    });
  }

  private player(socket: DominoSocket): DominoPlayer {
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
    socket: DominoSocket,
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
    socket: DominoSocket,
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

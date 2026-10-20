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
  TRUCO_NAMESPACE,
  TRUCO_PUBLIC_ROOMS_CHANNEL,
  TrucoClientEvents,
  trucoCreateSchema,
  trucoEmptySchema,
  trucoJoinSchema,
  trucoModeSchema,
  trucoPlayCardSchema,
  trucoReadySchema,
  trucoAddBotSchema,
  trucoRemoveBotSchema,
  trucoRequestBetSchema,
  trucoRespondBetSchema,
  trucoSignalSchema,
  trucoTakeSeatSchema,
  trucoTenDecisionSchema,
  trucoVisibilitySchema,
  userChannel,
  setStakeSchema,
  type Ack,
  type Seat,
  type TrucoSnapshot,
} from '../contracts';
import { JwtVerifier, type AuthUser } from '../core/auth/jwt-verifier';
import { ArenaService } from '../arena/arena.service';
import { DomainError } from '../core/domain-error';
import { RateLimiter } from '../game/rate-limiter';
import { ProfilesService } from '../profiles/profiles.service';
import { ActionDeduper } from './action-deduper';
import { SocketTrucoPublisher } from './truco-publisher';
import { TrucoRoomsService, type TrucoPlayer } from './truco-rooms.service';

interface SocketData {
  user: AuthUser;
  /** null until the profile has a nickname. */
  player: TrucoPlayer | null;
}
type AnyEvents = { [event: string]: (...args: unknown[]) => void };
type TrucoSocket = Socket<AnyEvents, AnyEvents, AnyEvents, SocketData>;
type Limit = 'default' | 'create' | 'signal';
type AckError = Extract<Ack<never>, { ok: false }>;

const LIMITS: Record<
  Limit,
  { suffix: string; limit: number; windowMs: number }
> = {
  default: { suffix: '', limit: 10, windowMs: 1_000 },
  create: { suffix: ':create', limit: 3, windowMs: 10_000 },
  signal: { suffix: ':signal', limit: 1, windowMs: 1_000 },
};

/**
 * Transport only: authenticates the socket, validates every payload with Zod,
 * rate limits, deduplicates game actions and delegates to TrucoRoomsService,
 * which is the single authority over the tables.
 */
@WebSocketGateway({ namespace: TRUCO_NAMESPACE })
export class TrucoGateway
  implements OnGatewayInit<Namespace>, OnGatewayDisconnect<TrucoSocket>
{
  private readonly logger = new Logger(TrucoGateway.name);
  private readonly limiter = new RateLimiter();
  private readonly deduper = new ActionDeduper<Ack<null>>();

  constructor(
    private readonly verifier: JwtVerifier,
    private readonly profiles: ProfilesService,
    private readonly tables: TrucoRoomsService,
    private readonly publisher: SocketTrucoPublisher,
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

  handleDisconnect(socket: TrucoSocket): void {
    this.limiter.forget(socket.id);
    const user = socket.data.user;
    if (user) this.tables.disconnect(user.id, socket.id);
  }

  @SubscribeMessage(TrucoClientEvents.CREATE)
  onCreate(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'create',
      trucoCreateSchema,
      body,
      async (_, { isPublic, mode }) => {
        const snapshot = this.tables.create(
          this.player(socket),
          socket.id,
          isPublic,
          mode,
        );
        await socket.join(roomChannel(snapshot.state.code));
        this.logger.log({
          event: 'truco_room_created',
          roomCode: snapshot.state.code,
        });
        return snapshot;
      },
    );
  }

  /** Lobby screen: current public tables now, then `truco:rooms_updated` on every change. */
  @SubscribeMessage(TrucoClientEvents.WATCH_ROOMS)
  onWatchRooms(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', trucoEmptySchema, body, async () => {
      await socket.join(TRUCO_PUBLIC_ROOMS_CHANNEL);
      return this.tables.listPublic();
    });
  }

  @SubscribeMessage(TrucoClientEvents.UNWATCH_ROOMS)
  onUnwatchRooms(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', trucoEmptySchema, body, async () => {
      await socket.leave(TRUCO_PUBLIC_ROOMS_CHANNEL);
      return null;
    });
  }

  @SubscribeMessage(TrucoClientEvents.SET_VISIBILITY)
  onSetVisibility(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      trucoVisibilitySchema,
      body,
      (user, { isPublic }) => {
        this.tables.setVisibility(user.id, isPublic);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(TrucoClientEvents.SET_MODE)
  onSetMode(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      trucoModeSchema,
      body,
      (user, { mode }) => {
        this.tables.setMode(user.id, mode);
        return Promise.resolve(null);
      },
    );
  }

  /** Host only: the bet of the next match. The host must be able to cover it. */
  @SubscribeMessage(TrucoClientEvents.SET_STAKE)
  onSetStake(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      setStakeSchema,
      body,
      async (user, { stake }) => {
        await this.arena.assertStake('TRUCO', stake, [user.id]);
        this.tables.setStake(user.id, stake);
        return null;
      },
    );
  }

  @SubscribeMessage(TrucoClientEvents.JOIN)
  onJoin(@ConnectedSocket() socket: TrucoSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      trucoJoinSchema,
      body,
      async (_, { code }): Promise<TrucoSnapshot> => {
        const player = this.player(socket);
        const stake = this.tables.stakeToJoin(code, player.userId);
        if (stake !== null)
          await this.arena.assertStake('TRUCO', stake, [player.userId]);
        const snapshot = this.tables.join(code, player, socket.id);
        await socket.join(roomChannel(code));
        return snapshot;
      },
    );
  }

  @SubscribeMessage(TrucoClientEvents.SYNC)
  onSync(@ConnectedSocket() socket: TrucoSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', trucoEmptySchema, body, (user) =>
      Promise.resolve(this.tables.sync(user.id)),
    );
  }

  @SubscribeMessage(TrucoClientEvents.LEAVE)
  onLeave(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', trucoEmptySchema, body, (user) => {
      this.tables.leave(user.id);
      return Promise.resolve(null);
    });
  }

  @SubscribeMessage(TrucoClientEvents.TAKE_SEAT)
  onTakeSeat(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      trucoTakeSeatSchema,
      body,
      (user, { seat }) => {
        this.tables.takeSeat(user.id, seat as Seat);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(TrucoClientEvents.READY)
  onReady(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      trucoReadySchema,
      body,
      (user, { ready }) => {
        this.tables.setReady(user.id, ready);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(TrucoClientEvents.ADD_BOT)
  onAddBot(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      trucoAddBotSchema,
      body,
      (user, { seat }) => {
        this.tables.addBot(user.id, seat as Seat | undefined);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(TrucoClientEvents.REMOVE_BOT)
  onRemoveBot(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      trucoRemoveBotSchema,
      body,
      (user, { seat }) => {
        this.tables.removeBot(user.id, seat as Seat);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(TrucoClientEvents.START)
  onStart(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      trucoEmptySchema,
      body,
      async (user) => {
        const check = this.tables.stakeCheck(user.id);
        await this.arena.assertStake('TRUCO', check.stake, check.userIds);
        this.tables.start(user.id);
        this.logger.log({
          event: 'truco_match_started',
          roomCode: this.tables.roomOf(user.id),
        });
        return null;
      },
    );
  }

  @SubscribeMessage(TrucoClientEvents.REMATCH)
  onRematch(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', trucoEmptySchema, body, (user) => {
      this.tables.rematch(user.id);
      return Promise.resolve(null);
    });
  }

  @SubscribeMessage(TrucoClientEvents.PLAY_CARD)
  onPlayCard(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.action(socket, trucoPlayCardSchema, body, (user, p) =>
      this.tables.playCard(user.id, p.cardId),
    );
  }

  @SubscribeMessage(TrucoClientEvents.REQUEST_BET)
  onRequestBet(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.action(socket, trucoRequestBetSchema, body, (user) =>
      this.tables.requestBet(user.id),
    );
  }

  @SubscribeMessage(TrucoClientEvents.RESPOND_BET)
  onRespondBet(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.action(socket, trucoRespondBetSchema, body, (user, p) =>
      this.tables.respondBet(user.id, p.response),
    );
  }

  @SubscribeMessage(TrucoClientEvents.TEN_DECISION)
  onTenDecision(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.action(socket, trucoTenDecisionSchema, body, (user, p) =>
      this.tables.decideTen(user.id, p.play),
    );
  }

  @SubscribeMessage(TrucoClientEvents.SIGNAL)
  onSignal(
    @ConnectedSocket() socket: TrucoSocket,
    @MessageBody() body: unknown,
  ) {
    // The gesture is never logged: it is private between partners.
    return this.handle(
      socket,
      'signal',
      trucoSignalSchema,
      body,
      (user, { gesture }) => {
        this.tables.signal(user.id, gesture);
        return Promise.resolve(null);
      },
    );
  }

  private player(socket: TrucoSocket): TrucoPlayer {
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
    socket: TrucoSocket,
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
    socket: TrucoSocket,
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

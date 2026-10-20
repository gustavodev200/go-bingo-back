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
  BJ_NAMESPACE,
  BJ_PUBLIC_ROOMS_CHANNEL,
  BjClientEvents,
  bjCreateSchema,
  bjEmptySchema,
  bjJoinSchema,
  bjActSchema,
  bjBetSchema,
  bjEmoteSchema,
  bjInsuranceSchema,
  bjSetRulesSchema,
  bjReadySchema,
  bjVisibilitySchema,
  userChannel,
  setStakeSchema,
  type Ack,
  type BjSnapshot,
} from '../contracts';
import { JwtVerifier, type AuthUser } from '../core/auth/jwt-verifier';
import { ArenaService } from '../arena/arena.service';
import { DomainError } from '../core/domain-error';
import { RateLimiter } from '../game/rate-limiter';
import { ProfilesService } from '../profiles/profiles.service';
import { ActionDeduper } from '../truco/action-deduper';
import { SocketBjPublisher } from './blackjack-publisher';
import { BjRoomsService, type BjPlayer } from './blackjack-rooms.service';

interface SocketData {
  user: AuthUser;
  /** null until the profile has a nickname. */
  player: BjPlayer | null;
}
type AnyEvents = { [event: string]: (...args: unknown[]) => void };
type BjSocket = Socket<AnyEvents, AnyEvents, AnyEvents, SocketData>;
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
 * rate limits, deduplicates game actions and delegates to BjRoomsService,
 * which is the single authority over the tables.
 */
@WebSocketGateway({ namespace: BJ_NAMESPACE })
export class BjGateway
  implements OnGatewayInit<Namespace>, OnGatewayDisconnect<BjSocket>
{
  private readonly logger = new Logger(BjGateway.name);
  private readonly limiter = new RateLimiter();
  private readonly deduper = new ActionDeduper<Ack<null>>();

  constructor(
    private readonly verifier: JwtVerifier,
    private readonly profiles: ProfilesService,
    private readonly tables: BjRoomsService,
    private readonly publisher: SocketBjPublisher,
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

  handleDisconnect(socket: BjSocket): void {
    this.limiter.forget(socket.id);
    const user = socket.data.user;
    if (user) this.tables.disconnect(user.id, socket.id);
  }

  @SubscribeMessage(BjClientEvents.CREATE)
  onCreate(@ConnectedSocket() socket: BjSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'create',
      bjCreateSchema,
      body,
      async (_, { isPublic }) => {
        const snapshot = this.tables.create(
          this.player(socket),
          socket.id,
          isPublic,
        );
        await socket.join(roomChannel(snapshot.state.code));
        this.logger.log({
          event: 'blackjack_room_created',
          roomCode: snapshot.state.code,
        });
        return snapshot;
      },
    );
  }

  /** Lobby screen: current public tables now, then `blackjack:rooms_updated` on every change. */
  @SubscribeMessage(BjClientEvents.WATCH_ROOMS)
  onWatchRooms(
    @ConnectedSocket() socket: BjSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', bjEmptySchema, body, async () => {
      await socket.join(BJ_PUBLIC_ROOMS_CHANNEL);
      return this.tables.listPublic();
    });
  }

  @SubscribeMessage(BjClientEvents.UNWATCH_ROOMS)
  onUnwatchRooms(
    @ConnectedSocket() socket: BjSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', bjEmptySchema, body, async () => {
      await socket.leave(BJ_PUBLIC_ROOMS_CHANNEL);
      return null;
    });
  }

  @SubscribeMessage(BjClientEvents.SET_VISIBILITY)
  onSetVisibility(
    @ConnectedSocket() socket: BjSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      bjVisibilitySchema,
      body,
      (user, { isPublic }) => {
        this.tables.setVisibility(user.id, isPublic);
        return Promise.resolve(null);
      },
    );
  }

  /** Host only: the bet of the next match. The host must be able to cover it. */
  @SubscribeMessage(BjClientEvents.SET_STAKE)
  onSetStake(
    @ConnectedSocket() socket: BjSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      setStakeSchema,
      body,
      async (user, { stake }) => {
        await this.arena.assertStake('BLACKJACK', stake, [user.id]);
        this.tables.setStake(user.id, stake);
        return null;
      },
    );
  }

  @SubscribeMessage(BjClientEvents.JOIN)
  onJoin(@ConnectedSocket() socket: BjSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      bjJoinSchema,
      body,
      async (_, { code }): Promise<BjSnapshot> => {
        const player = this.player(socket);
        const stake = this.tables.stakeToJoin(code, player.userId);
        if (stake !== null)
          await this.arena.assertStake('BLACKJACK', stake, [player.userId]);
        const snapshot = this.tables.join(code, player, socket.id);
        await socket.join(roomChannel(code));
        return snapshot;
      },
    );
  }

  @SubscribeMessage(BjClientEvents.SYNC)
  onSync(@ConnectedSocket() socket: BjSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', bjEmptySchema, body, (user) =>
      Promise.resolve(this.tables.sync(user.id)),
    );
  }

  @SubscribeMessage(BjClientEvents.LEAVE)
  onLeave(@ConnectedSocket() socket: BjSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', bjEmptySchema, body, (user) => {
      this.tables.leave(user.id);
      return Promise.resolve(null);
    });
  }

  @SubscribeMessage(BjClientEvents.SET_RULES)
  onSetRules(
    @ConnectedSocket() socket: BjSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      bjSetRulesSchema,
      body,
      (user, { rules }) => {
        this.tables.setRules(user.id, rules);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(BjClientEvents.READY)
  onReady(@ConnectedSocket() socket: BjSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      bjReadySchema,
      body,
      (user, { ready }) => {
        this.tables.setReady(user.id, ready);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(BjClientEvents.START)
  onStart(@ConnectedSocket() socket: BjSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', bjEmptySchema, body, async (user) => {
      const check = this.tables.stakeCheck(user.id);
      await this.arena.assertStake('BLACKJACK', check.stake, check.userIds);
      this.tables.start(user.id);
      this.logger.log({
        event: 'blackjack_match_started',
        roomCode: this.tables.roomOf(user.id),
      });
      return null;
    });
  }

  @SubscribeMessage(BjClientEvents.REMATCH)
  onRematch(@ConnectedSocket() socket: BjSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', bjEmptySchema, body, (user) => {
      this.tables.rematch(user.id);
      return Promise.resolve(null);
    });
  }

  @SubscribeMessage(BjClientEvents.BET)
  onBet(@ConnectedSocket() socket: BjSocket, @MessageBody() body: unknown) {
    return this.action(socket, bjBetSchema, body, (user, p) =>
      this.tables.bet(user.id, p.amount),
    );
  }

  @SubscribeMessage(BjClientEvents.INSURANCE)
  onInsurance(
    @ConnectedSocket() socket: BjSocket,
    @MessageBody() body: unknown,
  ) {
    return this.action(socket, bjInsuranceSchema, body, (user, p) =>
      this.tables.insurance(user.id, p.take),
    );
  }

  @SubscribeMessage(BjClientEvents.ACT)
  onAct(@ConnectedSocket() socket: BjSocket, @MessageBody() body: unknown) {
    return this.action(socket, bjActSchema, body, (user, p) =>
      this.tables.act(user.id, p.action),
    );
  }

  @SubscribeMessage(BjClientEvents.EMOTE)
  onEmote(@ConnectedSocket() socket: BjSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'emote', bjEmoteSchema, body, (user, p) => {
      this.tables.emote(user.id, p.emote);
      return Promise.resolve(null);
    });
  }

  private player(socket: BjSocket): BjPlayer {
    const player = socket.data.player;
    if (!player)
      throw new DomainError(
        'NICKNAME_REQUIRED',
        'Escolha um apelido antes de jogar',
      );
    return player;
  }

  /** Game actions: same as handle(), plus replay protection by actionId. */
  private action<S extends z.ZodType<{ actionId: string }>>(
    socket: BjSocket,
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
    socket: BjSocket,
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

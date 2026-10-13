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
  UNO_NAMESPACE,
  UNO_PUBLIC_ROOMS_CHANNEL,
  UnoClientEvents,
  unoCreateSchema,
  unoEmptySchema,
  unoJoinSchema,
  unoActionSchema,
  unoEmoteSchema,
  unoPlayCardSchema,
  unoSetRulesSchema,
  unoReadySchema,
  unoVisibilitySchema,
  userChannel,
  type Ack,
  type UnoSnapshot,
} from '../contracts';
import { JwtVerifier, type AuthUser } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { RateLimiter } from '../game/rate-limiter';
import { ProfilesService } from '../profiles/profiles.service';
import { ActionDeduper } from '../truco/action-deduper';
import { SocketUnoPublisher } from './uno-publisher';
import { UnoRoomsService, type UnoPlayer } from './uno-rooms.service';

interface SocketData {
  user: AuthUser;
  /** null until the profile has a nickname. */
  player: UnoPlayer | null;
}
type AnyEvents = { [event: string]: (...args: unknown[]) => void };
type UnoSocket = Socket<AnyEvents, AnyEvents, AnyEvents, SocketData>;
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
 * rate limits, deduplicates game actions and delegates to UnoRoomsService,
 * which is the single authority over the tables.
 */
@WebSocketGateway({ namespace: UNO_NAMESPACE })
export class UnoGateway
  implements OnGatewayInit<Namespace>, OnGatewayDisconnect<UnoSocket>
{
  private readonly logger = new Logger(UnoGateway.name);
  private readonly limiter = new RateLimiter();
  private readonly deduper = new ActionDeduper<Ack<null>>();

  constructor(
    private readonly verifier: JwtVerifier,
    private readonly profiles: ProfilesService,
    private readonly tables: UnoRoomsService,
    private readonly publisher: SocketUnoPublisher,
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

  handleDisconnect(socket: UnoSocket): void {
    this.limiter.forget(socket.id);
    const user = socket.data.user;
    if (user) this.tables.disconnect(user.id, socket.id);
  }

  @SubscribeMessage(UnoClientEvents.CREATE)
  onCreate(@ConnectedSocket() socket: UnoSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'create',
      unoCreateSchema,
      body,
      async (_, { isPublic }) => {
        const snapshot = this.tables.create(
          this.player(socket),
          socket.id,
          isPublic,
        );
        await socket.join(roomChannel(snapshot.state.code));
        this.logger.log({
          event: 'uno_room_created',
          roomCode: snapshot.state.code,
        });
        return snapshot;
      },
    );
  }

  /** Lobby screen: current public tables now, then `uno:rooms_updated` on every change. */
  @SubscribeMessage(UnoClientEvents.WATCH_ROOMS)
  onWatchRooms(
    @ConnectedSocket() socket: UnoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', unoEmptySchema, body, async () => {
      await socket.join(UNO_PUBLIC_ROOMS_CHANNEL);
      return this.tables.listPublic();
    });
  }

  @SubscribeMessage(UnoClientEvents.UNWATCH_ROOMS)
  onUnwatchRooms(
    @ConnectedSocket() socket: UnoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', unoEmptySchema, body, async () => {
      await socket.leave(UNO_PUBLIC_ROOMS_CHANNEL);
      return null;
    });
  }

  @SubscribeMessage(UnoClientEvents.SET_VISIBILITY)
  onSetVisibility(
    @ConnectedSocket() socket: UnoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      unoVisibilitySchema,
      body,
      (user, { isPublic }) => {
        this.tables.setVisibility(user.id, isPublic);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(UnoClientEvents.JOIN)
  onJoin(@ConnectedSocket() socket: UnoSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      unoJoinSchema,
      body,
      async (_, { code }): Promise<UnoSnapshot> => {
        const snapshot = this.tables.join(code, this.player(socket), socket.id);
        await socket.join(roomChannel(code));
        return snapshot;
      },
    );
  }

  @SubscribeMessage(UnoClientEvents.SYNC)
  onSync(@ConnectedSocket() socket: UnoSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', unoEmptySchema, body, (user) =>
      Promise.resolve(this.tables.sync(user.id)),
    );
  }

  @SubscribeMessage(UnoClientEvents.LEAVE)
  onLeave(@ConnectedSocket() socket: UnoSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', unoEmptySchema, body, (user) => {
      this.tables.leave(user.id);
      return Promise.resolve(null);
    });
  }

  @SubscribeMessage(UnoClientEvents.SET_RULES)
  onSetRules(
    @ConnectedSocket() socket: UnoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'default',
      unoSetRulesSchema,
      body,
      (user, { rules }) => {
        this.tables.setRules(user.id, rules);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(UnoClientEvents.READY)
  onReady(@ConnectedSocket() socket: UnoSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      unoReadySchema,
      body,
      (user, { ready }) => {
        this.tables.setReady(user.id, ready);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(UnoClientEvents.START)
  onStart(@ConnectedSocket() socket: UnoSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'default', unoEmptySchema, body, (user) => {
      this.tables.start(user.id);
      this.logger.log({
        event: 'uno_match_started',
        roomCode: this.tables.roomOf(user.id),
      });
      return Promise.resolve(null);
    });
  }

  @SubscribeMessage(UnoClientEvents.REMATCH)
  onRematch(
    @ConnectedSocket() socket: UnoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', unoEmptySchema, body, (user) => {
      this.tables.rematch(user.id);
      return Promise.resolve(null);
    });
  }

  @SubscribeMessage(UnoClientEvents.PLAY_CARD)
  onPlayCard(
    @ConnectedSocket() socket: UnoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.action(socket, unoPlayCardSchema, body, (user, p) =>
      this.tables.playCard(user.id, p.cardId, {
        color: p.color,
        target: p.target,
      }),
    );
  }

  @SubscribeMessage(UnoClientEvents.DRAW)
  onDraw(@ConnectedSocket() socket: UnoSocket, @MessageBody() body: unknown) {
    return this.action(socket, unoActionSchema, body, (user) =>
      this.tables.draw(user.id),
    );
  }

  @SubscribeMessage(UnoClientEvents.PASS)
  onPass(@ConnectedSocket() socket: UnoSocket, @MessageBody() body: unknown) {
    return this.action(socket, unoActionSchema, body, (user) =>
      this.tables.pass(user.id),
    );
  }

  @SubscribeMessage(UnoClientEvents.CHALLENGE)
  onChallenge(
    @ConnectedSocket() socket: UnoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.action(socket, unoActionSchema, body, (user) =>
      this.tables.challenge(user.id),
    );
  }

  @SubscribeMessage(UnoClientEvents.CALL_UNO)
  onCallUno(
    @ConnectedSocket() socket: UnoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.action(socket, unoActionSchema, body, (user) =>
      this.tables.callUno(user.id),
    );
  }

  @SubscribeMessage(UnoClientEvents.CATCH_UNO)
  onCatchUno(
    @ConnectedSocket() socket: UnoSocket,
    @MessageBody() body: unknown,
  ) {
    return this.action(socket, unoActionSchema, body, (user) =>
      this.tables.catchUno(user.id),
    );
  }

  @SubscribeMessage(UnoClientEvents.EMOTE)
  onEmote(@ConnectedSocket() socket: UnoSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'emote', unoEmoteSchema, body, (user, p) => {
      this.tables.emote(user.id, p.emote);
      return Promise.resolve(null);
    });
  }

  private player(socket: UnoSocket): UnoPlayer {
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
    socket: UnoSocket,
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
    socket: UnoSocket,
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

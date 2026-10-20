import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common';
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
  VOICE_NAMESPACE,
  VoiceClientEvents,
  voiceEmptySchema,
  voiceJoinSchema,
  voiceMuteSchema,
  VoiceServerEvents,
  voiceSignalSchema,
  type Ack,
  type VoiceGame,
  type VoiceIceServer,
  type VoiceJoined,
  type VoiceRemovedReason,
  type VoiceServerEventPayloads,
} from '../contracts';
import { JwtVerifier, type AuthUser } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { RateLimiter } from '../game/rate-limiter';
import { ProfilesService } from '../profiles/profiles.service';
import {
  VoiceChannelsService,
  type VoiceMember,
} from './voice-channels.service';

/** Whether `userId` currently sits in the room `code` of `game`. */
export interface VoiceMembership {
  isMember(game: VoiceGame, code: string, userId: string): Promise<boolean>;
}
export const VOICE_MEMBERSHIP = Symbol('VOICE_MEMBERSHIP');

export interface VoiceConfig {
  iceServers: VoiceIceServer[];
  /** How often everyone in voice is checked against the game room (kicked/left players drop out). */
  sweepMs: number;
}
export const VOICE_CONFIG = Symbol('VOICE_CONFIG');

interface SocketData {
  user: AuthUser;
  /** null until the profile has a nickname. */
  nickname: string | null;
}
type AnyEvents = { [event: string]: (...args: unknown[]) => void };
type VoiceSocket = Socket<AnyEvents, AnyEvents, AnyEvents, SocketData>;
type Limit = 'default' | 'signal';
type AckError = Extract<Ack<never>, { ok: false }>;

const LIMITS: Record<
  Limit,
  { suffix: string; limit: number; windowMs: number }
> = {
  default: { suffix: '', limit: 5, windowMs: 1_000 },
  // ICE gathering sends a burst of candidates per peer.
  signal: { suffix: ':signal', limit: 60, windowMs: 1_000 },
};

/**
 * Signaling for the voice chat: authenticates, checks the user is in the game
 * room, and relays offers/answers/ICE candidates between peers of the same
 * channel. Audio never passes through the server.
 */
@WebSocketGateway({ namespace: VOICE_NAMESPACE })
export class VoiceGateway
  implements
    OnGatewayInit<Namespace>,
    OnGatewayDisconnect<VoiceSocket>,
    OnModuleDestroy
{
  private readonly logger = new Logger(VoiceGateway.name);
  private readonly limiter = new RateLimiter();
  private server!: Namespace;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly verifier: JwtVerifier,
    private readonly profiles: ProfilesService,
    private readonly channels: VoiceChannelsService,
    @Inject(VOICE_MEMBERSHIP) private readonly membership: VoiceMembership,
    @Inject(VOICE_CONFIG) private readonly config: VoiceConfig,
  ) {}

  afterInit(server: Namespace): void {
    this.server = server;
    server.use((socket, next) => {
      const token: unknown = socket.handshake.auth?.token;
      if (typeof token !== 'string') return next(new Error('UNAUTHENTICATED'));
      this.verifier
        .verify(token)
        .then(async (user) => {
          const profile = await this.profiles.ensure(user);
          const data = socket.data as SocketData;
          data.user = user;
          data.nickname = profile.nickname;
          next();
        })
        .catch(() => next(new Error('UNAUTHENTICATED')));
    });
    this.sweepTimer = setInterval(() => void this.sweep(), this.config.sweepMs);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
  }

  handleDisconnect(socket: VoiceSocket): void {
    this.limiter.forget(socket.id);
    this.drop(socket.id);
  }

  @SubscribeMessage(VoiceClientEvents.JOIN)
  onJoin(@ConnectedSocket() socket: VoiceSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      voiceJoinSchema,
      body,
      async (user, { game, code, muted }): Promise<VoiceJoined> => {
        const nickname = socket.data.nickname;
        if (!nickname)
          throw new DomainError(
            'NICKNAME_REQUIRED',
            'Escolha um apelido antes de entrar',
          );
        if (!(await this.membership.isMember(game, code, user.id)))
          throw new DomainError('NOT_IN_ROOM', 'Você não está nesta sala');
        if (!socket.connected)
          throw new DomainError('INVALID_STATE', 'Desconectado');

        const peer = { peerId: socket.id, userId: user.id, nickname, muted };
        const { channel, others, replaced, left } = this.channels.join(
          peer,
          game,
          code,
        );
        if (left) await this.announceLeft(socket, left);
        if (replaced) this.evict(replaced, 'replaced');
        await socket.join(channel);
        socket.to(channel).emit(VoiceServerEvents.PEER_JOINED, peer);
        return {
          peerId: socket.id,
          peers: others,
          iceServers: this.config.iceServers,
        };
      },
    );
  }

  @SubscribeMessage(VoiceClientEvents.LEAVE)
  onLeave(
    @ConnectedSocket() socket: VoiceSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(socket, 'default', voiceEmptySchema, body, async () => {
      const left = this.channels.leave(socket.id);
      if (left) await this.announceLeft(socket, left);
      return null;
    });
  }

  @SubscribeMessage(VoiceClientEvents.MUTE)
  onMute(@ConnectedSocket() socket: VoiceSocket, @MessageBody() body: unknown) {
    return this.handle(
      socket,
      'default',
      voiceMuteSchema,
      body,
      (_, { muted }) => {
        const member = this.channels.setMuted(socket.id, muted);
        if (member)
          socket.to(member.channel).emit(VoiceServerEvents.PEER_UPDATED, {
            peerId: socket.id,
            muted,
          } satisfies VoiceServerEventPayloads['voice:peer_updated']);
        return Promise.resolve(null);
      },
    );
  }

  @SubscribeMessage(VoiceClientEvents.SIGNAL)
  onSignal(
    @ConnectedSocket() socket: VoiceSocket,
    @MessageBody() body: unknown,
  ) {
    return this.handle(
      socket,
      'signal',
      voiceSignalSchema,
      body,
      (_, { to, data }) => {
        if (!this.channels.sameChannel(socket.id, to))
          throw new DomainError('NOT_IN_ROOM', 'Participante fora do canal');
        this.server.to(to).emit(VoiceServerEvents.SIGNAL, {
          from: socket.id,
          data,
        } satisfies VoiceServerEventPayloads['voice:signal']);
        return Promise.resolve(null);
      },
    );
  }

  /** Drops from voice whoever is no longer in the game room (or, with `only`, in that room right now). */
  async sweep(only?: { game: VoiceGame; code: string }): Promise<void> {
    for (const member of this.channels.members()) {
      if (only && (member.game !== only.game || member.code !== only.code))
        continue;
      try {
        const still = await this.membership.isMember(
          member.game,
          member.code,
          member.peer.userId,
        );
        // The await let the member leave or rejoin meanwhile: only evict that same session.
        if (!still && this.channels.memberOf(member.peer.peerId) === member) {
          this.channels.leave(member.peer.peerId);
          this.evict(member, 'not_member');
        }
      } catch (error) {
        this.logger.error(error);
        Sentry.captureException(error);
      }
    }
  }

  private drop(peerId: string): void {
    const left = this.channels.leave(peerId);
    if (left)
      this.server.to(left.channel).emit(VoiceServerEvents.PEER_LEFT, {
        peerId,
      } satisfies VoiceServerEventPayloads['voice:peer_left']);
  }

  /** Tells the channel and the socket of a member the server already removed. */
  private evict(member: VoiceMember, reason: VoiceRemovedReason): void {
    const peerId = member.peer.peerId;
    this.server.in(peerId).socketsLeave(member.channel);
    this.server.to(member.channel).emit(VoiceServerEvents.PEER_LEFT, {
      peerId,
    } satisfies VoiceServerEventPayloads['voice:peer_left']);
    this.server.to(peerId).emit(VoiceServerEvents.REMOVED, {
      reason,
    } satisfies VoiceServerEventPayloads['voice:removed']);
  }

  private async announceLeft(
    socket: VoiceSocket,
    member: VoiceMember,
  ): Promise<void> {
    await socket.leave(member.channel);
    this.server.to(member.channel).emit(VoiceServerEvents.PEER_LEFT, {
      peerId: socket.id,
    } satisfies VoiceServerEventPayloads['voice:peer_left']);
  }

  private async handle<S extends z.ZodType, R>(
    socket: VoiceSocket,
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

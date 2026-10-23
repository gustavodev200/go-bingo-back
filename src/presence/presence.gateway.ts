import { type OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import {
  PRESENCE_NAMESPACE,
  PresenceServerEvents,
  type PresenceCount,
} from '../contracts';
import { JwtVerifier, type AuthUser } from '../core/auth/jwt-verifier';

interface SocketData {
  user: AuthUser;
}
type AnyEvents = { [event: string]: (...args: unknown[]) => void };
type PresenceSocket = Socket<AnyEvents, AnyEvents, AnyEvents, SocketData>;

/** Joins/leaves inside this window go out as a single broadcast. */
export const PRESENCE_BROADCAST_MS = 500;

/**
 * Counts the distinct users connected to the platform (several tabs of the
 * same user count once) and pushes the total to everyone when it changes.
 */
@WebSocketGateway({ namespace: PRESENCE_NAMESPACE })
export class PresenceGateway
  implements
    OnGatewayInit<Namespace>,
    OnGatewayConnection<PresenceSocket>,
    OnGatewayDisconnect<PresenceSocket>,
    OnModuleDestroy
{
  private server!: Namespace;
  /** userId → ids of that user's open sockets. */
  private readonly sockets = new Map<string, Set<string>>();
  private lastSent = -1;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly verifier: JwtVerifier) {}

  afterInit(server: Namespace): void {
    this.server = server;
    server.use((socket, next) => {
      const token: unknown = socket.handshake.auth?.token;
      if (typeof token !== 'string') return next(new Error('UNAUTHENTICATED'));
      this.verifier
        .verify(token)
        .then((user) => {
          (socket.data as SocketData).user = user;
          next();
        })
        .catch(() => next(new Error('UNAUTHENTICATED')));
    });
  }

  onModuleDestroy(): void {
    clearTimeout(this.timer);
  }

  get online(): number {
    return this.sockets.size;
  }

  handleConnection(socket: PresenceSocket): void {
    const userId = socket.data.user.id;
    const ids = this.sockets.get(userId) ?? new Set<string>();
    ids.add(socket.id);
    this.sockets.set(userId, ids);
    // The newcomer gets the number right away; the others on the next broadcast.
    socket.emit(PresenceServerEvents.COUNT, this.payload());
    this.scheduleBroadcast();
  }

  handleDisconnect(socket: PresenceSocket): void {
    const userId = socket.data.user?.id;
    if (!userId) return;
    const ids = this.sockets.get(userId);
    if (!ids) return;
    ids.delete(socket.id);
    if (ids.size === 0) this.sockets.delete(userId);
    this.scheduleBroadcast();
  }

  private payload(): PresenceCount {
    return { online: this.online };
  }

  private scheduleBroadcast(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.online === this.lastSent) return;
      this.lastSent = this.online;
      this.server.emit(PresenceServerEvents.COUNT, this.payload());
    }, PRESENCE_BROADCAST_MS);
    this.timer.unref?.();
  }
}

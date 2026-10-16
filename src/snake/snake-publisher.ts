import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import {
  SNAKE_PUBLIC_ROOMS_CHANNEL,
  SnakeServerEvents,
  roomChannel,
  type SnakePublicRoom,
  type SnakeServerEventName,
  type SnakeServerEventPayloads,
} from '../contracts';

/** Where the rooms service sends things; the Socket.IO implementation lives below. */
export interface SnakePublisher {
  toRoom<E extends SnakeServerEventName>(
    code: string,
    event: E,
    payload: SnakeServerEventPayloads[E],
  ): void;
  toSocket<E extends SnakeServerEventName>(
    socketId: string,
    event: E,
    payload: SnakeServerEventPayloads[E],
  ): void;
  /** What one player sees this tick; may be dropped for slow clients (the next one replaces it). */
  frame(socketId: string, frame: ArrayBuffer): void;
  /** Takes a socket out of the room broadcast channel. */
  removeFromRoom(socketId: string, code: string): void;
  /** Something that may change the public list happened; `list` is read when it is sent. */
  publicRoomsChanged(list: () => SnakePublicRoom[]): void;
}

const PUBLIC_DEBOUNCE_MS = 300;

export const SNAKE_PUBLISHER = Symbol('SNAKE_PUBLISHER');

/** Channels live inside the /snake namespace, so they never collide with other games. */
@Injectable()
export class SocketSnakePublisher implements SnakePublisher, OnModuleDestroy {
  private server?: Namespace;
  private publicTimer?: NodeJS.Timeout;

  attach(server: Namespace): void {
    this.server = server;
  }

  toRoom<E extends SnakeServerEventName>(
    code: string,
    event: E,
    payload: SnakeServerEventPayloads[E],
  ): void {
    this.server?.to(roomChannel(code)).emit(event, payload);
  }

  toSocket<E extends SnakeServerEventName>(
    socketId: string,
    event: E,
    payload: SnakeServerEventPayloads[E],
  ): void {
    this.server?.to(socketId).emit(event, payload);
  }

  frame(socketId: string, frame: ArrayBuffer): void {
    this.server?.to(socketId).volatile.emit(SnakeServerEvents.FRAME, frame);
  }

  removeFromRoom(socketId: string, code: string): void {
    this.server?.in(socketId).socketsLeave(roomChannel(code));
  }

  /** Coalesces bursts into one list per window. */
  publicRoomsChanged(list: () => SnakePublicRoom[]): void {
    if (this.publicTimer) return;
    this.publicTimer = setTimeout(() => {
      this.publicTimer = undefined;
      this.server
        ?.to(SNAKE_PUBLIC_ROOMS_CHANNEL)
        .emit(SnakeServerEvents.ROOMS_UPDATED, { rooms: list() });
    }, PUBLIC_DEBOUNCE_MS);
  }

  onModuleDestroy(): void {
    clearTimeout(this.publicTimer);
  }
}

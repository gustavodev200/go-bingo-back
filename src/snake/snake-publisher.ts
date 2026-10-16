import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import {
  SnakeServerEvents,
  type SnakeServerEventName,
  type SnakeServerEventPayloads,
} from '../contracts';

export const snakeArenaChannel = (id: number) => `arena:${id}`;

/** Where the arenas service sends things; the Socket.IO implementation lives below. */
export interface SnakePublisher {
  toArena<E extends SnakeServerEventName>(
    arenaId: number,
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
}

export const SNAKE_PUBLISHER = Symbol('SNAKE_PUBLISHER');

/** Channels live inside the /snake namespace, so they never collide with other games. */
@Injectable()
export class SocketSnakePublisher implements SnakePublisher {
  private server?: Namespace;

  attach(server: Namespace): void {
    this.server = server;
  }

  toArena<E extends SnakeServerEventName>(
    arenaId: number,
    event: E,
    payload: SnakeServerEventPayloads[E],
  ): void {
    this.server?.to(snakeArenaChannel(arenaId)).emit(event, payload);
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
}

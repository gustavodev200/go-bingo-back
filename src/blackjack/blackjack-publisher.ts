import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import {
  roomChannel,
  BJ_PUBLIC_ROOMS_CHANNEL,
  BjServerEvents,
  userChannel,
  type BjPublicRoom,
  type BjServerEventName,
  type BjServerEventPayloads,
} from '../contracts';

/** Where the rooms service sends things; the Socket.IO implementation lives below. */
export interface BjPublisher {
  toRoom<E extends BjServerEventName>(
    code: string,
    event: E,
    payload: BjServerEventPayloads[E],
  ): void;
  toUser<E extends BjServerEventName>(
    userId: string,
    event: E,
    payload: BjServerEventPayloads[E],
  ): void;
  /** Removes every socket of the user from the room broadcast channel. */
  removeFromRoom(userId: string, code: string): void;
  /** Something that may change the public list happened; `list` is read when it is sent. */
  publicRoomsChanged(list: () => BjPublicRoom[]): void;
}

const PUBLIC_DEBOUNCE_MS = 300;

export const BJ_PUBLISHER = Symbol('BJ_PUBLISHER');

/**
 * Channels live inside the /blackjack namespace, so `room:CODE` and `user:ID`
 * never collide with the bingo ones in /game.
 */
@Injectable()
export class SocketBjPublisher implements BjPublisher, OnModuleDestroy {
  private server?: Namespace;
  private publicTimer?: NodeJS.Timeout;

  attach(server: Namespace): void {
    this.server = server;
  }

  toRoom<E extends BjServerEventName>(
    code: string,
    event: E,
    payload: BjServerEventPayloads[E],
  ): void {
    this.server?.to(roomChannel(code)).emit(event, payload);
  }

  toUser<E extends BjServerEventName>(
    userId: string,
    event: E,
    payload: BjServerEventPayloads[E],
  ): void {
    this.server?.to(userChannel(userId)).emit(event, payload);
  }

  removeFromRoom(userId: string, code: string): void {
    this.server?.in(userChannel(userId)).socketsLeave(roomChannel(code));
  }

  /** Coalesces bursts (every move publishes) into one list per window. */
  publicRoomsChanged(list: () => BjPublicRoom[]): void {
    if (this.publicTimer) return;
    this.publicTimer = setTimeout(() => {
      this.publicTimer = undefined;
      this.server
        ?.to(BJ_PUBLIC_ROOMS_CHANNEL)
        .emit(BjServerEvents.ROOMS_UPDATED, { rooms: list() });
    }, PUBLIC_DEBOUNCE_MS);
  }

  onModuleDestroy(): void {
    clearTimeout(this.publicTimer);
  }
}

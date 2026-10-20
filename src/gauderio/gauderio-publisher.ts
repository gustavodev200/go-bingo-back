import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import {
  roomChannel,
  GAUD_PUBLIC_ROOMS_CHANNEL,
  GaudServerEvents,
  userChannel,
  type GaudPublicRoom,
  type GaudServerEventName,
  type GaudServerEventPayloads,
} from '../contracts';

/** Where the rooms service sends things; the Socket.IO implementation lives below. */
export interface GaudPublisher {
  toRoom<E extends GaudServerEventName>(
    code: string,
    event: E,
    payload: GaudServerEventPayloads[E],
  ): void;
  toUser<E extends GaudServerEventName>(
    userId: string,
    event: E,
    payload: GaudServerEventPayloads[E],
  ): void;
  /** Removes every socket of the user from the room broadcast channel. */
  removeFromRoom(userId: string, code: string): void;
  /** Something that may change the public list happened; `list` is read when it is sent. */
  publicRoomsChanged(list: () => GaudPublicRoom[]): void;
}

const PUBLIC_DEBOUNCE_MS = 300;

export const GAUD_PUBLISHER = Symbol('GAUD_PUBLISHER');

/**
 * Channels live inside the /gauderio namespace, so `room:CODE` and `user:ID`
 * never collide with the bingo ones in /game.
 */
@Injectable()
export class SocketGaudPublisher implements GaudPublisher, OnModuleDestroy {
  private server?: Namespace;
  private publicTimer?: NodeJS.Timeout;

  attach(server: Namespace): void {
    this.server = server;
  }

  toRoom<E extends GaudServerEventName>(
    code: string,
    event: E,
    payload: GaudServerEventPayloads[E],
  ): void {
    this.server?.to(roomChannel(code)).emit(event, payload);
  }

  toUser<E extends GaudServerEventName>(
    userId: string,
    event: E,
    payload: GaudServerEventPayloads[E],
  ): void {
    this.server?.to(userChannel(userId)).emit(event, payload);
  }

  removeFromRoom(userId: string, code: string): void {
    this.server?.in(userChannel(userId)).socketsLeave(roomChannel(code));
  }

  /** Coalesces bursts (every card played publishes) into one list per window. */
  publicRoomsChanged(list: () => GaudPublicRoom[]): void {
    if (this.publicTimer) return;
    this.publicTimer = setTimeout(() => {
      this.publicTimer = undefined;
      this.server
        ?.to(GAUD_PUBLIC_ROOMS_CHANNEL)
        .emit(GaudServerEvents.ROOMS_UPDATED, { rooms: list() });
    }, PUBLIC_DEBOUNCE_MS);
  }

  onModuleDestroy(): void {
    clearTimeout(this.publicTimer);
  }
}

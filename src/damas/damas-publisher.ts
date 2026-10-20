import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import {
  roomChannel,
  DAMAS_PUBLIC_ROOMS_CHANNEL,
  DamasServerEvents,
  userChannel,
  type DamasPublicRoom,
  type DamasServerEventName,
  type DamasServerEventPayloads,
} from '../contracts';

/** Where the rooms service sends things; the Socket.IO implementation lives below. */
export interface DamasPublisher {
  toRoom<E extends DamasServerEventName>(
    code: string,
    event: E,
    payload: DamasServerEventPayloads[E],
  ): void;
  toUser<E extends DamasServerEventName>(
    userId: string,
    event: E,
    payload: DamasServerEventPayloads[E],
  ): void;
  /** Removes every socket of the user from the room broadcast channel. */
  removeFromRoom(userId: string, code: string): void;
  /** Something that may change the public list happened; `list` is read when it is sent. */
  publicRoomsChanged(list: () => DamasPublicRoom[]): void;
}

const PUBLIC_DEBOUNCE_MS = 300;

export const DAMAS_PUBLISHER = Symbol('DAMAS_PUBLISHER');

/**
 * Channels live inside the /damas namespace, so `room:CODE` and `user:ID`
 * never collide with the bingo ones in /game.
 */
@Injectable()
export class SocketDamasPublisher implements DamasPublisher, OnModuleDestroy {
  private server?: Namespace;
  private publicTimer?: NodeJS.Timeout;

  attach(server: Namespace): void {
    this.server = server;
  }

  toRoom<E extends DamasServerEventName>(
    code: string,
    event: E,
    payload: DamasServerEventPayloads[E],
  ): void {
    this.server?.to(roomChannel(code)).emit(event, payload);
  }

  toUser<E extends DamasServerEventName>(
    userId: string,
    event: E,
    payload: DamasServerEventPayloads[E],
  ): void {
    this.server?.to(userChannel(userId)).emit(event, payload);
  }

  removeFromRoom(userId: string, code: string): void {
    this.server?.in(userChannel(userId)).socketsLeave(roomChannel(code));
  }

  /** Coalesces bursts (every move publishes) into one list per window. */
  publicRoomsChanged(list: () => DamasPublicRoom[]): void {
    if (this.publicTimer) return;
    this.publicTimer = setTimeout(() => {
      this.publicTimer = undefined;
      this.server
        ?.to(DAMAS_PUBLIC_ROOMS_CHANNEL)
        .emit(DamasServerEvents.ROOMS_UPDATED, { rooms: list() });
    }, PUBLIC_DEBOUNCE_MS);
  }

  onModuleDestroy(): void {
    clearTimeout(this.publicTimer);
  }
}

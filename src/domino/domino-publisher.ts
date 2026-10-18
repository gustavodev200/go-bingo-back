import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import {
  roomChannel,
  DOMINO_PUBLIC_ROOMS_CHANNEL,
  DominoServerEvents,
  userChannel,
  type DominoPublicRoom,
  type DominoServerEventName,
  type DominoServerEventPayloads,
} from '../contracts';

/** Where the rooms service sends things; the Socket.IO implementation lives below. */
export interface DominoPublisher {
  toRoom<E extends DominoServerEventName>(
    code: string,
    event: E,
    payload: DominoServerEventPayloads[E],
  ): void;
  toUser<E extends DominoServerEventName>(
    userId: string,
    event: E,
    payload: DominoServerEventPayloads[E],
  ): void;
  /** Removes every socket of the user from the room broadcast channel. */
  removeFromRoom(userId: string, code: string): void;
  /** Something that may change the public list happened; `list` is read when it is sent. */
  publicRoomsChanged(list: () => DominoPublicRoom[]): void;
}

const PUBLIC_DEBOUNCE_MS = 300;

export const DOMINO_PUBLISHER = Symbol('DOMINO_PUBLISHER');

/**
 * Channels live inside the /domino namespace, so `room:CODE` and `user:ID`
 * never collide with the bingo ones in /game.
 */
@Injectable()
export class SocketDominoPublisher implements DominoPublisher, OnModuleDestroy {
  private server?: Namespace;
  private publicTimer?: NodeJS.Timeout;

  attach(server: Namespace): void {
    this.server = server;
  }

  toRoom<E extends DominoServerEventName>(
    code: string,
    event: E,
    payload: DominoServerEventPayloads[E],
  ): void {
    this.server?.to(roomChannel(code)).emit(event, payload);
  }

  toUser<E extends DominoServerEventName>(
    userId: string,
    event: E,
    payload: DominoServerEventPayloads[E],
  ): void {
    this.server?.to(userChannel(userId)).emit(event, payload);
  }

  removeFromRoom(userId: string, code: string): void {
    this.server?.in(userChannel(userId)).socketsLeave(roomChannel(code));
  }

  /** Coalesces bursts (every card played publishes) into one list per window. */
  publicRoomsChanged(list: () => DominoPublicRoom[]): void {
    if (this.publicTimer) return;
    this.publicTimer = setTimeout(() => {
      this.publicTimer = undefined;
      this.server
        ?.to(DOMINO_PUBLIC_ROOMS_CHANNEL)
        .emit(DominoServerEvents.ROOMS_UPDATED, { rooms: list() });
    }, PUBLIC_DEBOUNCE_MS);
  }

  onModuleDestroy(): void {
    clearTimeout(this.publicTimer);
  }
}

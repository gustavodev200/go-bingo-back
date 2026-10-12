import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import {
  roomChannel,
  TRUCO_PUBLIC_ROOMS_CHANNEL,
  TrucoServerEvents,
  userChannel,
  type TrucoPublicRoom,
  type TrucoServerEventName,
  type TrucoServerEventPayloads,
} from '../contracts';

/** Where the rooms service sends things; the Socket.IO implementation lives below. */
export interface TrucoPublisher {
  toRoom<E extends TrucoServerEventName>(
    code: string,
    event: E,
    payload: TrucoServerEventPayloads[E],
  ): void;
  toUser<E extends TrucoServerEventName>(
    userId: string,
    event: E,
    payload: TrucoServerEventPayloads[E],
  ): void;
  /** Removes every socket of the user from the room broadcast channel. */
  removeFromRoom(userId: string, code: string): void;
  /** Something that may change the public list happened; `list` is read when it is sent. */
  publicRoomsChanged(list: () => TrucoPublicRoom[]): void;
}

const PUBLIC_DEBOUNCE_MS = 300;

export const TRUCO_PUBLISHER = Symbol('TRUCO_PUBLISHER');

/**
 * Channels live inside the /truco namespace, so `room:CODE` and `user:ID`
 * never collide with the bingo ones in /game.
 */
@Injectable()
export class SocketTrucoPublisher implements TrucoPublisher, OnModuleDestroy {
  private server?: Namespace;
  private publicTimer?: NodeJS.Timeout;

  attach(server: Namespace): void {
    this.server = server;
  }

  toRoom<E extends TrucoServerEventName>(
    code: string,
    event: E,
    payload: TrucoServerEventPayloads[E],
  ): void {
    this.server?.to(roomChannel(code)).emit(event, payload);
  }

  toUser<E extends TrucoServerEventName>(
    userId: string,
    event: E,
    payload: TrucoServerEventPayloads[E],
  ): void {
    this.server?.to(userChannel(userId)).emit(event, payload);
  }

  removeFromRoom(userId: string, code: string): void {
    this.server?.in(userChannel(userId)).socketsLeave(roomChannel(code));
  }

  /** Coalesces bursts (every card played publishes) into one list per window. */
  publicRoomsChanged(list: () => TrucoPublicRoom[]): void {
    if (this.publicTimer) return;
    this.publicTimer = setTimeout(() => {
      this.publicTimer = undefined;
      this.server
        ?.to(TRUCO_PUBLIC_ROOMS_CHANNEL)
        .emit(TrucoServerEvents.ROOMS_UPDATED, { rooms: list() });
    }, PUBLIC_DEBOUNCE_MS);
  }

  onModuleDestroy(): void {
    clearTimeout(this.publicTimer);
  }
}

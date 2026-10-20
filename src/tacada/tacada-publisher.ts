import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import {
  roomChannel,
  TACADA_PUBLIC_ROOMS_CHANNEL,
  TacadaServerEvents,
  userChannel,
  type TacadaPublicRoom,
  type TacadaServerEventName,
  type TacadaServerEventPayloads,
} from '../contracts';

/** Where the rooms service sends things; the Socket.IO implementation lives below. */
export interface TacadaPublisher {
  toRoom<E extends TacadaServerEventName>(
    code: string,
    event: E,
    payload: TacadaServerEventPayloads[E],
  ): void;
  toUser<E extends TacadaServerEventName>(
    userId: string,
    event: E,
    payload: TacadaServerEventPayloads[E],
  ): void;
  /** Removes every socket of the user from the room broadcast channel. */
  removeFromRoom(userId: string, code: string): void;
  /** Something that may change the public list happened; `list` is read when it is sent. */
  publicRoomsChanged(list: () => TacadaPublicRoom[]): void;
}

const PUBLIC_DEBOUNCE_MS = 300;

export const TACADA_PUBLISHER = Symbol('TACADA_PUBLISHER');

/**
 * Channels live inside the /tacada namespace, so `room:CODE` and `user:ID`
 * never collide with the bingo ones in /game.
 */
@Injectable()
export class SocketTacadaPublisher implements TacadaPublisher, OnModuleDestroy {
  private server?: Namespace;
  private publicTimer?: NodeJS.Timeout;

  attach(server: Namespace): void {
    this.server = server;
  }

  toRoom<E extends TacadaServerEventName>(
    code: string,
    event: E,
    payload: TacadaServerEventPayloads[E],
  ): void {
    this.server?.to(roomChannel(code)).emit(event, payload);
  }

  toUser<E extends TacadaServerEventName>(
    userId: string,
    event: E,
    payload: TacadaServerEventPayloads[E],
  ): void {
    this.server?.to(userChannel(userId)).emit(event, payload);
  }

  removeFromRoom(userId: string, code: string): void {
    this.server?.in(userChannel(userId)).socketsLeave(roomChannel(code));
  }

  /** Coalesces bursts (every move publishes) into one list per window. */
  publicRoomsChanged(list: () => TacadaPublicRoom[]): void {
    if (this.publicTimer) return;
    this.publicTimer = setTimeout(() => {
      this.publicTimer = undefined;
      this.server
        ?.to(TACADA_PUBLIC_ROOMS_CHANNEL)
        .emit(TacadaServerEvents.ROOMS_UPDATED, { rooms: list() });
    }, PUBLIC_DEBOUNCE_MS);
  }

  onModuleDestroy(): void {
    clearTimeout(this.publicTimer);
  }
}

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import {
  BOMBER_PUBLIC_ROOMS_CHANNEL,
  BomberServerEvents,
  roomChannel,
  userChannel,
  type BomberFrame,
  type BomberPublicRoom,
  type BomberServerEventName,
  type BomberServerEventPayloads,
} from '../contracts';

/** Where the rooms service sends things; the Socket.IO implementation lives below. */
export interface BomberPublisher {
  toRoom<E extends BomberServerEventName>(
    code: string,
    event: E,
    payload: BomberServerEventPayloads[E],
  ): void;
  /** Arena frame of the current tick; may be dropped for slow clients (the next one replaces it). */
  frame(code: string, frame: BomberFrame): void;
  /** Removes every socket of the user from the room broadcast channel. */
  removeFromRoom(userId: string, code: string): void;
  /** Something that may change the public list happened; `list` is read when it is sent. */
  publicRoomsChanged(list: () => BomberPublicRoom[]): void;
}

const PUBLIC_DEBOUNCE_MS = 300;

export const BOMBER_PUBLISHER = Symbol('BOMBER_PUBLISHER');

/** Channels live inside the /bomber namespace, so they never collide with other games. */
@Injectable()
export class SocketBomberPublisher implements BomberPublisher, OnModuleDestroy {
  private server?: Namespace;
  private publicTimer?: NodeJS.Timeout;

  attach(server: Namespace): void {
    this.server = server;
  }

  toRoom<E extends BomberServerEventName>(
    code: string,
    event: E,
    payload: BomberServerEventPayloads[E],
  ): void {
    this.server?.to(roomChannel(code)).emit(event, payload);
  }

  frame(code: string, frame: BomberFrame): void {
    this.server
      ?.to(roomChannel(code))
      .volatile.emit(BomberServerEvents.FRAME, frame);
  }

  removeFromRoom(userId: string, code: string): void {
    this.server?.in(userChannel(userId)).socketsLeave(roomChannel(code));
  }

  /** Coalesces bursts into one list per window. */
  publicRoomsChanged(list: () => BomberPublicRoom[]): void {
    if (this.publicTimer) return;
    this.publicTimer = setTimeout(() => {
      this.publicTimer = undefined;
      this.server
        ?.to(BOMBER_PUBLIC_ROOMS_CHANNEL)
        .emit(BomberServerEvents.ROOMS_UPDATED, { rooms: list() });
    }, PUBLIC_DEBOUNCE_MS);
  }

  onModuleDestroy(): void {
    clearTimeout(this.publicTimer);
  }
}

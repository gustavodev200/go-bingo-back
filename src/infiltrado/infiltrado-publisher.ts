import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import {
  INF_PUBLIC_ROOMS_CHANNEL,
  InfServerEvents,
  roomChannel,
  userChannel,
  type InfChatMessage,
  type InfFrame,
  type InfPublicRoom,
  type InfServerEventName,
  type InfServerEventPayloads,
} from '../contracts';

/** Where the rooms service sends things; the Socket.IO implementation lives below. */
export interface InfPublisher {
  toRoom<E extends InfServerEventName>(
    code: string,
    event: E,
    payload: InfServerEventPayloads[E],
  ): void;
  /** What one player sees this tick; may be dropped for slow clients (the next one replaces it). */
  frame(userId: string, frame: InfFrame): void;
  chat(userId: string, message: InfChatMessage): void;
  /** Removes every socket of the user from the room broadcast channel. */
  removeFromRoom(userId: string, code: string): void;
  /** Something that may change the public list happened; `list` is read when it is sent. */
  publicRoomsChanged(list: () => InfPublicRoom[]): void;
}

const PUBLIC_DEBOUNCE_MS = 300;

export const INF_PUBLISHER = Symbol('INF_PUBLISHER');

/** Frames go to each player's own channel: nobody receives what they cannot see. */
@Injectable()
export class SocketInfPublisher implements InfPublisher, OnModuleDestroy {
  private server?: Namespace;
  private publicTimer?: NodeJS.Timeout;

  attach(server: Namespace): void {
    this.server = server;
  }

  toRoom<E extends InfServerEventName>(
    code: string,
    event: E,
    payload: InfServerEventPayloads[E],
  ): void {
    this.server?.to(roomChannel(code)).emit(event, payload);
  }

  frame(userId: string, frame: InfFrame): void {
    this.server
      ?.to(userChannel(userId))
      .volatile.emit(InfServerEvents.FRAME, frame);
  }

  chat(userId: string, message: InfChatMessage): void {
    this.server?.to(userChannel(userId)).emit(InfServerEvents.CHAT, message);
  }

  removeFromRoom(userId: string, code: string): void {
    this.server?.in(userChannel(userId)).socketsLeave(roomChannel(code));
  }

  /** Coalesces bursts into one list per window. */
  publicRoomsChanged(list: () => InfPublicRoom[]): void {
    if (this.publicTimer) return;
    this.publicTimer = setTimeout(() => {
      this.publicTimer = undefined;
      this.server
        ?.to(INF_PUBLIC_ROOMS_CHANNEL)
        .emit(InfServerEvents.ROOMS_UPDATED, { rooms: list() });
    }, PUBLIC_DEBOUNCE_MS);
  }

  onModuleDestroy(): void {
    clearTimeout(this.publicTimer);
  }
}

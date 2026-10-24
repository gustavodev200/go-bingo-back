import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import {
  BOTAO_PUBLIC_ROOMS_CHANNEL,
  BotaoServerEvents,
  roomChannel,
  userChannel,
  type BotaoFrame,
  type BotaoPublicRoom,
  type BotaoServerEventName,
  type BotaoServerEventPayloads,
} from '../contracts';

/** Where the rooms service sends things; the Socket.IO implementation lives below. */
export interface BotaoPublisher {
  toRoom<E extends BotaoServerEventName>(
    code: string,
    event: E,
    payload: BotaoServerEventPayloads[E],
  ): void;
  /** Arena frame of the current tick; may be dropped for slow clients (the next one replaces it). */
  frame(code: string, frame: BotaoFrame): void;
  /** Removes every socket of the user from the room broadcast channel. */
  removeFromRoom(userId: string, code: string): void;
  /** Something that may change the public list happened; `list` is read when it is sent. */
  publicRoomsChanged(list: () => BotaoPublicRoom[]): void;
}

const PUBLIC_DEBOUNCE_MS = 300;

export const BOTAO_PUBLISHER = Symbol('BOTAO_PUBLISHER');

/** Channels live inside the /botao namespace, so they never collide with other games. */
@Injectable()
export class SocketBotaoPublisher implements BotaoPublisher, OnModuleDestroy {
  private server?: Namespace;
  private publicTimer?: NodeJS.Timeout;

  attach(server: Namespace): void {
    this.server = server;
  }

  toRoom<E extends BotaoServerEventName>(
    code: string,
    event: E,
    payload: BotaoServerEventPayloads[E],
  ): void {
    this.server?.to(roomChannel(code)).emit(event, payload);
  }

  frame(code: string, frame: BotaoFrame): void {
    this.server
      ?.to(roomChannel(code))
      .volatile.emit(BotaoServerEvents.FRAME, frame);
  }

  removeFromRoom(userId: string, code: string): void {
    this.server?.in(userChannel(userId)).socketsLeave(roomChannel(code));
  }

  /** Coalesces bursts into one list per window. */
  publicRoomsChanged(list: () => BotaoPublicRoom[]): void {
    if (this.publicTimer) return;
    this.publicTimer = setTimeout(() => {
      this.publicTimer = undefined;
      this.server
        ?.to(BOTAO_PUBLIC_ROOMS_CHANNEL)
        .emit(BotaoServerEvents.ROOMS_UPDATED, { rooms: list() });
    }, PUBLIC_DEBOUNCE_MS);
  }

  onModuleDestroy(): void {
    clearTimeout(this.publicTimer);
  }
}

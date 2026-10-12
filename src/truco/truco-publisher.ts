import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import {
  roomChannel,
  userChannel,
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
}

export const TRUCO_PUBLISHER = Symbol('TRUCO_PUBLISHER');

/**
 * Channels live inside the /truco namespace, so `room:CODE` and `user:ID`
 * never collide with the bingo ones in /game.
 */
@Injectable()
export class SocketTrucoPublisher implements TrucoPublisher {
  private server?: Namespace;

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
}

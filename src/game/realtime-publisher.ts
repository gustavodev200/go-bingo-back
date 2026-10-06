import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import {
  PUBLIC_ROOMS_CHANNEL,
  roomChannel,
  ServerEvents,
  userChannel,
  type ServerEventName,
  type ServerEventPayloads,
} from '../contracts';
import { RoomsService } from '../rooms/rooms.service';

const PUBLIC_DEBOUNCE_MS = 500;

@Injectable()
export class RealtimePublisher implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimePublisher.name);
  private server?: Namespace;
  private publicTimer?: NodeJS.Timeout;

  constructor(private readonly rooms: RoomsService) {}

  attach(server: Namespace): void {
    this.server = server;
  }

  toRoom<E extends ServerEventName>(
    code: string,
    event: E,
    payload: ServerEventPayloads[E],
  ): void {
    this.server?.to(roomChannel(code)).emit(event, payload);
  }

  toUser<E extends ServerEventName>(
    userId: string,
    event: E,
    payload: ServerEventPayloads[E],
  ): void {
    this.server?.to(userChannel(userId)).emit(event, payload);
  }

  removeUserFromRoom(userId: string, code: string): void {
    this.server?.in(userChannel(userId)).socketsLeave(roomChannel(code));
  }

  closeRoomChannel(code: string): void {
    this.server?.in(roomChannel(code)).socketsLeave(roomChannel(code));
  }

  publicRoomsChanged(): void {
    if (this.publicTimer) return;
    this.publicTimer = setTimeout(() => {
      this.publicTimer = undefined;
      this.rooms
        .listPublic()
        .then((rooms) =>
          this.server
            ?.to(PUBLIC_ROOMS_CHANNEL)
            .emit(ServerEvents.ROOMS_UPDATED, { rooms }),
        )
        .catch((error: unknown) => this.logger.error(error));
    }, PUBLIC_DEBOUNCE_MS);
  }

  onModuleDestroy(): void {
    clearTimeout(this.publicTimer);
  }
}

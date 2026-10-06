import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { RECONNECT_GRACE_MS } from '../contracts';

interface Entry {
  sockets: Set<string>;
  timer?: NodeJS.Timeout;
}

@Injectable()
export class PresenceService implements OnModuleDestroy {
  private readonly rooms = new Map<string, Map<string, Entry>>();
  private onExpired: (code: string, userId: string) => void = () => undefined;

  setExpiryHandler(fn: (code: string, userId: string) => void): void {
    this.onExpired = fn;
  }

  connect(
    code: string,
    userId: string,
    socketId: string,
  ): { firstSocket: boolean; reconnected: boolean } {
    const room = this.room(code);
    const entry = room.get(userId);
    if (!entry) {
      room.set(userId, { sockets: new Set([socketId]) });
      return { firstSocket: true, reconnected: false };
    }
    const reconnected = entry.timer !== undefined;
    clearTimeout(entry.timer);
    entry.timer = undefined;
    const firstSocket = entry.sockets.size === 0;
    entry.sockets.add(socketId);
    return { firstSocket, reconnected };
  }

  disconnect(
    code: string,
    userId: string,
    socketId: string,
  ): { offline: boolean } {
    const entry = this.rooms.get(code)?.get(userId);
    if (!entry) return { offline: false };
    entry.sockets.delete(socketId);
    if (entry.sockets.size > 0) return { offline: false };
    entry.timer = setTimeout(() => {
      this.rooms.get(code)?.delete(userId);
      this.onExpired(code, userId);
    }, RECONNECT_GRACE_MS);
    return { offline: true };
  }

  remove(code: string, userId: string): void {
    const entry = this.rooms.get(code)?.get(userId);
    if (entry) clearTimeout(entry.timer);
    this.rooms.get(code)?.delete(userId);
  }

  clearRoom(code: string): void {
    for (const entry of this.rooms.get(code)?.values() ?? [])
      clearTimeout(entry.timer);
    this.rooms.delete(code);
  }

  connectedSet(code: string): Set<string> {
    const online = new Set<string>();
    for (const [userId, entry] of this.rooms.get(code) ?? [])
      if (entry.sockets.size > 0) online.add(userId);
    return online;
  }

  onModuleDestroy(): void {
    for (const code of [...this.rooms.keys()]) this.clearRoom(code);
  }

  private room(code: string): Map<string, Entry> {
    let room = this.rooms.get(code);
    if (!room) {
      room = new Map();
      this.rooms.set(code, room);
    }
    return room;
  }
}

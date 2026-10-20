import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  CPU_MIN_MS,
  SNAKE_CPU_FILL,
  SNAKE_MAX_PLAYERS,
  SNAKE_SKINS,
  SNAKE_TICK_MS,
  SNAKE_TICK_RATE,
  encodeSnakeFrame,
  type SnakeInput,
  type SnakeMeta,
  type SnakePublicRoom,
  type SnakeRoomState,
  type SnakeServerEventPayloads,
  type SnakeSnapshot,
} from '../contracts';
import { ArenaService } from '../arena/arena.service';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../core/domain-error';
import { RANDOM_INT, type RandomInt } from '../core/random';
import { DRAW_TIMER, type DrawTimer } from '../game/draw-timer';
import { generateRoomCode } from '../rooms/room-code';
import { Arena, type ArenaEvent, type Snake } from './engine/arena';
import { SNAKE_BOT_NAMES, steerBot } from './engine/bot';
import { SNAKE_PUBLISHER, type SnakePublisher } from './snake-publisher';

export interface SnakeConfig {
  /** How long a player who lost every socket keeps the place in the room. */
  reconnectGraceMs: number;
  /** Rooms in memory at most (each runs a 20 Hz loop). */
  maxRooms: number;
  /** Snakes the CPU fills the arena up to (default SNAKE_CPU_FILL; 0 = no CPU). */
  cpuFill?: number;
}
export const SNAKE_CONFIG = Symbol('SNAKE_CONFIG');

export interface SnakePlayer {
  userId: string;
  nickname: string;
  character: string | null;
}

interface PlayerState extends SnakePlayer {
  sockets: Set<string>;
  /** 0 while watching (before the first life or after dying). */
  snakeId: number;
  view: [number, number];
  cam: [number, number];
  /** Died and still looking at where it happened (no leader camera). */
  dead: boolean;
  bornAt: number;
  expiryTimer: unknown;
}

interface Room {
  code: string;
  isPublic: boolean;
  hostId: string;
  arena: Arena;
  players: Map<string, PlayerState>;
  bySnake: Map<number, PlayerState>;
  /** Cobras da CPU vivas (id da cobra). Completam a arena enquanto há pouca gente. */
  bots: Set<number>;
  timer: unknown;
  /** When the next tick is due (performance.now ms); keeps a steady 20 Hz. */
  nextTickAt: number;
  version: number;
}

const MIN_VIEW = 300;
const MAX_VIEW = 4000;

/**
 * The single authority over Snake.io rooms: public/private rooms with a
 * code, up to 20 players, the 20 Hz arena loop, per-player frames,
 * leaderboard, reconnection window and host handover. While few people are
 * online, CPU snakes fill the arena (up to SNAKE_CPU_FILL snakes in all), so
 * one player alone can play too.
 */
@Injectable()
export class SnakeRoomsService implements OnModuleDestroy {
  private readonly rooms = new Map<string, Room>();
  private readonly userRoom = new Map<string, string>();

  constructor(
    @Inject(SNAKE_CONFIG) private readonly config: SnakeConfig,
    @Inject(SNAKE_PUBLISHER) private readonly publisher: SnakePublisher,
    @Inject(RANDOM_INT) private readonly random: RandomInt,
    @Inject(DRAW_TIMER) private readonly timer: DrawTimer,
    private readonly arena: ArenaService,
  ) {}

  roomOf(userId: string): string | undefined {
    return this.userRoom.get(userId);
  }

  create(
    player: SnakePlayer,
    socketId: string,
    isPublic = true,
  ): SnakeSnapshot {
    this.assertFree(player.userId);
    if (this.rooms.size >= this.config.maxRooms)
      throw new DomainError(
        'INVALID_STATE',
        'Muitas salas abertas agora. Tente daqui a pouco',
      );
    let code: string;
    do code = generateRoomCode(this.random);
    while (this.rooms.has(code));
    const room: Room = {
      code,
      isPublic,
      hostId: player.userId,
      // Events only fire from step(), after `room` exists.
      arena: new Arena({ onEvent: (ev) => this.onEvent(room, ev) }),
      players: new Map(),
      bySnake: new Map(),
      bots: new Set(),
      timer: undefined,
      nextTickAt: performance.now() + SNAKE_TICK_MS,
      version: 0,
    };
    this.rooms.set(code, room);
    this.addPlayer(room, player, socketId);
    this.schedule(room);
    this.publish(room);
    return this.snapshot(room);
  }

  /** Enters a room; the same user again (reconnection, another tab) keeps the place. */
  join(code: string, player: SnakePlayer, socketId: string): SnakeSnapshot {
    const current = this.userRoom.get(player.userId);
    if (current && current !== code) this.assertFree(player.userId);
    const room = this.rooms.get(code);
    if (!room) throw new DomainError('NOT_FOUND', 'Sala não encontrada');
    const me = room.players.get(player.userId);
    if (me) {
      me.sockets.add(socketId);
      this.timer.clear(me.expiryTimer);
      me.expiryTimer = undefined;
    } else {
      if (room.players.size >= SNAKE_MAX_PLAYERS)
        throw new DomainError('ROOM_FULL', 'A sala está cheia');
      this.addPlayer(room, player, socketId);
    }
    this.ensureConnectedHost(room);
    this.publish(room);
    return this.snapshot(room);
  }

  /** Public rooms with a free place, fullest first. */
  listPublic(): SnakePublicRoom[] {
    const out: SnakePublicRoom[] = [];
    for (const room of this.rooms.values()) {
      if (!room.isPublic || room.players.size >= SNAKE_MAX_PLAYERS) continue;
      const host = room.players.get(room.hostId)!;
      out.push({
        code: room.code,
        hostNickname: host.nickname,
        hostCharacter: host.character,
        players: room.players.size,
      });
    }
    return out.sort((a, b) => b.players - a.players);
  }

  setVisibility(userId: string, isPublic: boolean): void {
    const room = this.requireRoom(userId);
    if (room.hostId !== userId)
      throw new DomainError('NOT_HOST', 'Só o anfitrião muda a visibilidade');
    room.isPublic = isPublic;
    this.publish(room);
  }

  play(userId: string, skin: number): { id: number } {
    const room = this.requireRoom(userId);
    const p = room.players.get(userId)!;
    const current = room.arena.snakes.get(p.snakeId);
    if (current) return { id: current.id };
    const s = room.arena.spawn(
      p.nickname,
      Math.max(0, Math.min(SNAKE_SKINS.length - 1, skin)),
    );
    p.snakeId = s.id;
    p.dead = false;
    p.bornAt = Date.now();
    room.bySnake.set(s.id, p);
    this.publish(room);
    return { id: s.id };
  }

  input(userId: string, input: SnakeInput): void {
    const p = this.playerOf(userId);
    if (p?.snakeId)
      this.rooms
        .get(this.userRoom.get(userId)!)
        ?.arena.setInput(p.snakeId, input.a, input.b);
  }

  view(userId: string, w: number, h: number): void {
    const p = this.playerOf(userId);
    if (p)
      p.view = [clamp(w, MIN_VIEW, MAX_VIEW), clamp(h, MIN_VIEW, MAX_VIEW)];
  }

  leave(userId: string): string {
    const room = this.requireRoom(userId);
    this.removePlayer(room, userId);
    return room.code;
  }

  /**
   * A socket closed. When it was the user's last one the snake dies on the
   * spot (.io rules) and the place stays reserved for the reconnection window.
   */
  disconnect(userId: string, socketId: string): void {
    const code = this.userRoom.get(userId);
    const room = code ? this.rooms.get(code) : undefined;
    const p = room?.players.get(userId);
    if (!room || !p) return;
    if (!p.sockets.delete(socketId) || p.sockets.size > 0) return;
    const s = room.arena.snakes.get(p.snakeId);
    if (s) room.arena.kill(s, null);
    p.expiryTimer = this.timer.set(() => {
      if (
        this.rooms.get(room.code) === room &&
        room.players.get(userId) === p &&
        !p.sockets.size
      )
        this.removePlayer(room, userId);
    }, this.config.reconnectGraceMs);
    this.ensureConnectedHost(room);
    this.publish(room);
  }

  onModuleDestroy(): void {
    for (const room of this.rooms.values()) {
      this.timer.clear(room.timer);
      for (const p of room.players.values()) this.timer.clear(p.expiryTimer);
    }
    this.rooms.clear();
    this.userRoom.clear();
  }

  // ---------- internals ----------

  private assertFree(userId: string): void {
    if (this.userRoom.has(userId))
      throw new DomainError(
        'INVALID_STATE',
        'Você já está em uma sala. Saia dela antes',
      );
  }

  private requireRoom(userId: string): Room {
    const code = this.userRoom.get(userId);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room)
      throw new DomainError('NOT_IN_ROOM', 'Você não está em uma sala');
    return room;
  }

  private playerOf(userId: string): PlayerState | undefined {
    const code = this.userRoom.get(userId);
    return code ? this.rooms.get(code)?.players.get(userId) : undefined;
  }

  private addPlayer(room: Room, player: SnakePlayer, socketId: string): void {
    room.players.set(player.userId, {
      ...player,
      sockets: new Set([socketId]),
      snakeId: 0,
      view: [1600, 900],
      cam: [0, 0],
      dead: false,
      bornAt: 0,
      expiryTimer: undefined,
    });
    this.userRoom.set(player.userId, room.code);
  }

  private removePlayer(room: Room, userId: string): void {
    const p = room.players.get(userId);
    if (!p) return;
    this.timer.clear(p.expiryTimer);
    room.players.delete(userId);
    this.userRoom.delete(userId);
    for (const socketId of p.sockets)
      this.publisher.removeFromRoom(socketId, room.code);
    const s = room.arena.snakes.get(p.snakeId);
    if (s) room.arena.kill(s, null);
    room.bySnake.delete(p.snakeId);
    if (!room.players.size) {
      this.timer.clear(room.timer);
      this.rooms.delete(room.code);
      this.publisher.publicRoomsChanged(() => this.listPublic());
      return;
    }
    this.ensureConnectedHost(room);
    this.publish(room);
  }

  /** The host is always someone connected when there is anyone connected. */
  private ensureConnectedHost(room: Room): void {
    if (room.players.get(room.hostId)?.sockets.size) return;
    const next = [...room.players.values()].find((p) => p.sockets.size);
    if (next) room.hostId = next.userId;
  }

  private state(room: Room): SnakeRoomState {
    return {
      code: room.code,
      isPublic: room.isPublic,
      hostId: room.hostId,
      players: [...room.players.values()].map((p) => ({
        userId: p.userId,
        nickname: p.nickname,
        character: p.character,
        connected: p.sockets.size > 0,
        playing: room.arena.snakes.has(p.snakeId),
      })),
      version: room.version,
    };
  }

  private snapshot(room: Room): SnakeSnapshot {
    return {
      state: this.state(room),
      radius: room.arena.radius,
      meta: [...room.arena.snakes.values()].map(metaOf),
    };
  }

  private publish(room: Room): void {
    room.version++;
    this.publisher.toRoom(room.code, 'snake:state', this.state(room));
    this.publisher.publicRoomsChanged(() => this.listPublic());
  }

  /**
   * Fixed-rate loop: each wait is measured to the next due time, so the time
   * spent ticking and timer lateness don't pile up (steady frames = smooth clients).
   */
  private schedule(room: Room): void {
    const now = performance.now();
    // Way behind (e.g. the process stalled): restart the cadence instead of bursting.
    if (now - room.nextTickAt > SNAKE_TICK_MS * 5) room.nextTickAt = now;
    room.timer = this.timer.set(
      () => {
        if (this.rooms.get(room.code) !== room) return;
        room.nextTickAt += SNAKE_TICK_MS;
        this.tick(room);
        this.schedule(room);
      },
      Math.max(0, room.nextTickAt - now),
    );
  }

  private onEvent(room: Room, ev: ArenaEvent): void {
    const s = ev.snake;
    if (ev.t === 'spawn') {
      this.publisher.toRoom(room.code, 'snake:meta', { meta: [metaOf(s)] });
      return;
    }
    this.publisher.toRoom(room.code, 'snake:feed', {
      killer: ev.killer?.name ?? null,
      victim: s.name,
      killerId: ev.killer?.id ?? 0,
      victimId: s.id,
    });
    if (room.bots.delete(s.id)) {
      const hunter = ev.killer ? room.bySnake.get(ev.killer.id) : undefined;
      if (hunter) this.settleCpu(hunter, true);
      return;
    }
    const p = room.bySnake.get(s.id);
    if (!p) return;
    if (ev.killer && room.bots.has(ev.killer.id)) this.settleCpu(p, false);
    else this.settleKill(room, p, ev.killer);
    room.bySnake.delete(s.id);
    p.snakeId = 0;
    p.dead = true;
    p.cam = [s.head[0], s.head[1]];
    const rank = room.arena.ranking().filter((o) => o.mass > s.best).length + 1;
    const dead: SnakeServerEventPayloads['snake:dead'] = {
      killer: ev.killer?.name ?? null,
      score: Math.floor(s.best),
      kills: s.kills,
      rank,
      secs: Math.round((Date.now() - p.bornAt) / 1000),
    };
    for (const socketId of p.sockets)
      this.publisher.toSocket(socketId, 'snake:dead', dead);
    // `playing` changed; skip while the room is being torn down by removePlayer.
    if (room.players.has(p.userId)) this.publish(room);
  }

  /** Cada abate entre dois jogadores é um duelo: o abatido paga a recompensa e o rating anda. */
  private settleKill(
    room: Room,
    victim: PlayerState,
    killer: Snake | null,
  ): void {
    const winner = killer ? room.bySnake.get(killer.id) : undefined;
    if (!winner || winner.userId === victim.userId) return;
    void this.arena.settleSafe({
      matchId: randomUUID(),
      game: 'SNAKE',
      durationMs: Date.now() - victim.bornAt,
      participants: [
        { userId: winner.userId, placement: 1 },
        { userId: victim.userId, placement: 2 },
      ],
    });
  }

  /**
   * Abate envolvendo a CPU: sem ranking nem duelo, só o agrado fixo (vitória ao derrubar uma
   * CPU, participação ao cair para ela), com a vida durando pelo menos CPU_MIN_MS.
   */
  private settleCpu(human: PlayerState, won: boolean): void {
    const durationMs = Date.now() - human.bornAt;
    if (durationMs < CPU_MIN_MS) return;
    void this.arena.settleSafe({
      matchId: randomUUID(),
      game: 'SNAKE',
      durationMs,
      cpuPlayers: 1,
      participants: [{ userId: human.userId, placement: won ? 1 : 2 }],
    });
  }

  /** Completa a arena com CPUs até SNAKE_CPU_FILL cobras e decide para onde elas vão. */
  private driveBots(room: Room): void {
    const arena = room.arena;
    if (arena.tick % SNAKE_TICK_RATE === 0) {
      const online = [...room.players.values()].filter(
        (p) => p.sockets.size,
      ).length;
      const fill = this.config.cpuFill ?? SNAKE_CPU_FILL;
      const want = online > 0 ? Math.max(0, fill - online) : 0;
      if (room.bots.size < want) {
        const used = new Set(
          [...room.bots].map((id) => arena.snakes.get(id)?.name),
        );
        const name =
          SNAKE_BOT_NAMES.find((n) => !used.has(n)) ?? SNAKE_BOT_NAMES[0];
        const skin = Math.floor(arena.rng() * SNAKE_SKINS.length);
        room.bots.add(arena.spawn(name, skin).id);
      }
    }
    if (arena.tick % 2 !== 0) return;
    for (const id of room.bots) {
      const s = arena.snakes.get(id);
      if (!s) continue;
      const { angle, boost } = steerBot(arena, s, arena.rng);
      arena.setInput(id, angle, boost);
    }
  }

  private tick(room: Room): void {
    const arena = room.arena;
    this.driveBots(room);
    arena.step();

    const ranking = arena.ranking();
    const leader = ranking[0];
    for (const p of room.players.values()) {
      if (!p.sockets.size) continue;
      const me = arena.snakes.get(p.snakeId);
      if (me) p.cam = [me.head[0], me.head[1]];
      else if (!p.dead && leader) p.cam = [leader.head[0], leader.head[1]];
      const view = arena.viewAt(p.cam[0], p.cam[1], p.view[0], p.view[1]);
      const frame = encodeSnakeFrame({
        tick: arena.tick,
        myId: me?.id ?? 0,
        myMass: me?.mass ?? 0,
        camX: p.cam[0],
        camY: p.cam[1],
        ...view,
      });
      for (const socketId of p.sockets) this.publisher.frame(socketId, frame);
    }

    if (arena.tick % SNAKE_TICK_RATE !== 0) return;
    const top10 = ranking.slice(0, 10);
    const top = top10.map((s) => ({
      id: s.id,
      name: s.name,
      score: Math.floor(s.mass),
    }));
    const dots = top10.map((s): [number, number] => [
      Math.round(s.head[0]),
      Math.round(s.head[1]),
    ]);
    for (const p of room.players.values()) {
      const me = arena.snakes.get(p.snakeId);
      const payload: SnakeServerEventPayloads['snake:leaderboard'] = {
        top,
        dots,
        total: ranking.length,
        rank: me ? ranking.indexOf(me) + 1 : 0,
        me: me
          ? {
              score: Math.floor(me.mass),
              kills: me.kills,
              x: Math.round(me.head[0]),
              y: Math.round(me.head[1]),
            }
          : null,
      };
      for (const socketId of p.sockets)
        this.publisher.toSocket(socketId, 'snake:leaderboard', payload);
    }
  }
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const metaOf = (s: Snake): SnakeMeta => [s.id, s.name, s.skin];

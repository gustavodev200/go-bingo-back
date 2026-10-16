import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  SNAKE_SKINS,
  SNAKE_TICK_MS,
  SNAKE_TICK_RATE,
  encodeSnakeFrame,
  type SnakeInput,
  type SnakeJoinData,
  type SnakeMeta,
  type SnakeServerEventPayloads,
} from '../contracts';
import { DomainError } from '../core/domain-error';
import { DRAW_TIMER, type DrawTimer } from '../game/draw-timer';
import { Arena, type ArenaEvent, type Snake } from './engine/arena';
import { SNAKE_BOT_NAMES, snakeBotThink } from './engine/bot';
import { SNAKE_PUBLISHER, type SnakePublisher } from './snake-publisher';

export interface SnakeConfig {
  /** CPUs keep each arena at this many snakes while few humans are around (0 = humans only). */
  bots: number;
  /** Humans per arena; a new arena opens when every one is full. */
  maxPlayers: number;
  maxArenas: number;
}
export const SNAKE_CONFIG = Symbol('SNAKE_CONFIG');

export interface SnakePlayer {
  userId: string;
  nickname: string;
}

interface PlayerState extends SnakePlayer {
  socketId: string;
  arenaId: number;
  /** 0 while spectating (menu or after dying). */
  snakeId: number;
  view: [number, number];
  cam: [number, number];
  /** Died and still looking at where it happened (no leader camera). */
  dead: boolean;
  bornAt: number;
}

interface ArenaState {
  id: number;
  arena: Arena;
  players: Map<string, PlayerState>;
  bySnake: Map<number, PlayerState>;
  timer: unknown;
}

const MIN_VIEW = 300;
const MAX_VIEW = 4000;
const BOT_SPAWN_EVERY = 8; // ticks

/**
 * The single authority over the open arenas: who is in which, the 20 Hz
 * loop, CPU population, per-player frames and the leaderboard.
 */
@Injectable()
export class SnakeArenasService implements OnModuleDestroy {
  private readonly arenas = new Map<number, ArenaState>();
  private readonly players = new Map<string, PlayerState>();
  private nextArena = 1;

  constructor(
    @Inject(SNAKE_CONFIG) private readonly config: SnakeConfig,
    @Inject(SNAKE_PUBLISHER) private readonly publisher: SnakePublisher,
    @Inject(DRAW_TIMER) private readonly timer: DrawTimer,
  ) {}

  /** Enters an arena as a spectator (or takes over the same player from a new socket). */
  join(player: SnakePlayer, socketId: string): SnakeJoinData {
    let p = this.players.get(player.userId);
    if (p) {
      p.socketId = socketId;
      p.nickname = player.nickname;
    } else {
      const a = this.pickArena();
      p = {
        ...player,
        socketId,
        arenaId: a.id,
        snakeId: 0,
        view: [1600, 900],
        cam: [0, 0],
        dead: false,
        bornAt: 0,
      };
      this.players.set(player.userId, p);
      a.players.set(player.userId, p);
    }
    const a = this.arenas.get(p.arenaId)!;
    return {
      arena: a.id,
      radius: a.arena.radius,
      meta: [...a.arena.snakes.values()].map(metaOf),
    };
  }

  arenaOf(userId: string): number | null {
    return this.players.get(userId)?.arenaId ?? null;
  }

  play(userId: string, skin: number): { id: number } {
    const p = this.mustGet(userId);
    const a = this.arenas.get(p.arenaId)!;
    const current = a.arena.snakes.get(p.snakeId);
    if (current) return { id: current.id };
    const s = a.arena.spawn(
      p.nickname,
      Math.max(0, Math.min(SNAKE_SKINS.length - 1, skin)),
    );
    p.snakeId = s.id;
    p.dead = false;
    p.bornAt = Date.now();
    a.bySnake.set(s.id, p);
    return { id: s.id };
  }

  input(userId: string, input: SnakeInput): void {
    const p = this.players.get(userId);
    if (!p?.snakeId) return;
    this.arenas.get(p.arenaId)?.arena.setInput(p.snakeId, input.a, input.b);
  }

  view(userId: string, w: number, h: number): void {
    const p = this.players.get(userId);
    if (!p) return;
    p.view = [clamp(w, MIN_VIEW, MAX_VIEW), clamp(h, MIN_VIEW, MAX_VIEW)];
  }

  /** Leaves the arena; a live snake dies on the spot (its remains stay for the others). */
  leave(userId: string): void {
    const p = this.players.get(userId);
    if (!p) return;
    const a = this.arenas.get(p.arenaId);
    this.players.delete(userId);
    if (!a) return;
    a.players.delete(userId);
    const s = a.arena.snakes.get(p.snakeId);
    if (s) a.arena.kill(s, null);
    a.bySnake.delete(p.snakeId);
    if (!a.players.size) this.closeArena(a);
  }

  /** Only the socket currently driving the player can take it out. */
  disconnect(userId: string, socketId: string): void {
    if (this.players.get(userId)?.socketId === socketId) this.leave(userId);
  }

  onModuleDestroy(): void {
    for (const a of this.arenas.values()) this.timer.clear(a.timer);
    this.arenas.clear();
    this.players.clear();
  }

  // ---------- internals ----------

  private mustGet(userId: string): PlayerState {
    const p = this.players.get(userId);
    if (!p) throw new DomainError('NOT_IN_ROOM', 'Entre na arena primeiro');
    return p;
  }

  private pickArena(): ArenaState {
    for (const a of this.arenas.values())
      if (a.players.size < this.config.maxPlayers) return a;
    if (this.arenas.size >= this.config.maxArenas)
      throw new DomainError(
        'ROOM_FULL',
        'Todas as arenas estão cheias, tente daqui a pouco',
      );
    const a: ArenaState = {
      id: this.nextArena++,
      // Events only fire from step(), after `a` exists.
      arena: new Arena({
        think: snakeBotThink,
        onEvent: (ev) => this.onEvent(a, ev),
      }),
      players: new Map(),
      bySnake: new Map(),
      timer: undefined,
    };
    this.arenas.set(a.id, a);
    this.schedule(a);
    return a;
  }

  private closeArena(a: ArenaState): void {
    this.timer.clear(a.timer);
    this.arenas.delete(a.id);
  }

  private schedule(a: ArenaState): void {
    a.timer = this.timer.set(() => {
      if (!this.arenas.has(a.id)) return;
      this.tick(a);
      this.schedule(a);
    }, SNAKE_TICK_MS);
  }

  private onEvent(a: ArenaState, ev: ArenaEvent): void {
    const s = ev.snake;
    if (ev.t === 'spawn') {
      this.publisher.toArena(a.id, 'snake:meta', { meta: [metaOf(s)] });
      return;
    }
    this.publisher.toArena(a.id, 'snake:feed', {
      killer: ev.killer?.name ?? null,
      victim: s.name,
      killerId: ev.killer?.id ?? 0,
      victimId: s.id,
    });
    const p = a.bySnake.get(s.id);
    if (!p) return;
    a.bySnake.delete(s.id);
    p.snakeId = 0;
    p.dead = true;
    p.cam = [s.head[0], s.head[1]];
    const rank = a.arena.ranking().filter((o) => o.mass > s.best).length + 1;
    this.publisher.toSocket(p.socketId, 'snake:dead', {
      killer: ev.killer?.name ?? null,
      score: Math.floor(s.best),
      kills: s.kills,
      rank,
      secs: Math.round((Date.now() - p.bornAt) / 1000),
    });
  }

  private maintainBots(a: ArenaState): void {
    if (a.arena.tick % BOT_SPAWN_EVERY !== 0) return;
    const target = Math.max(0, this.config.bots - a.players.size);
    let bots = 0;
    const used = new Set<string>();
    for (const s of a.arena.snakes.values()) {
      used.add(s.name);
      if (s.isBot) bots++;
    }
    if (bots >= target) return;
    const rnd = a.arena.rng;
    const free = SNAKE_BOT_NAMES.filter((n) => !used.has(n));
    const pool = free.length ? free : SNAKE_BOT_NAMES;
    // Mixed sizes so a new player meets both prey and threats.
    a.arena.spawn(
      pool[Math.floor(rnd() * pool.length)],
      Math.floor(rnd() * SNAKE_SKINS.length),
      true,
      undefined,
      30 + rnd() ** 2 * 250,
    );
  }

  private tick(a: ArenaState): void {
    const arena = a.arena;
    arena.step();
    this.maintainBots(a);

    const ranking = arena.ranking();
    const leader = ranking[0];
    for (const p of a.players.values()) {
      const me = arena.snakes.get(p.snakeId);
      if (me) p.cam = [me.head[0], me.head[1]];
      else if (!p.dead && leader) p.cam = [leader.head[0], leader.head[1]];
      const view = arena.viewAt(p.cam[0], p.cam[1], p.view[0], p.view[1]);
      this.publisher.frame(
        p.socketId,
        encodeSnakeFrame({
          tick: arena.tick,
          myId: me?.id ?? 0,
          myMass: me?.mass ?? 0,
          camX: p.cam[0],
          camY: p.cam[1],
          ...view,
        }),
      );
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
    for (const p of a.players.values()) {
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
      this.publisher.toSocket(p.socketId, 'snake:leaderboard', payload);
    }
  }
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const metaOf = (s: Snake): SnakeMeta => [s.id, s.name, s.skin];

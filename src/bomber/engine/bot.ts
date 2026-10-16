import {
  BOMBER_COLS,
  BOMBER_DIRS,
  BOMBER_DT,
  BOMBER_FUSE,
  BOMBER_ITEMS,
  BOMBER_ROWS,
  BOMBER_TILE,
  isBomberItem,
  isSolidTile,
} from '../../contracts';
import type { BomberRound, RoundInput, RoundPlayer } from './round';

/** Per-bot state kept between ticks. */
export interface BotMemory {
  goal?: number | null;
  goalBomb?: boolean;
  cool?: number;
  repick?: number;
}

const N = BOMBER_COLS * BOMBER_ROWS;
const INF = Infinity;
const idx = (x: number, y: number) => y * BOMBER_COLS + x;
const xOf = (k: number) => k % BOMBER_COLS;
const yOf = (k: number) => Math.floor(k / BOMBER_COLS);

interface DangerBomb {
  x: number;
  y: number;
  fire: number;
  t: number;
}

function rays(
  round: BomberRound,
  b: DangerBomb,
  bombAt: Set<number>,
): number[] {
  const out = [idx(b.x, b.y)];
  for (let d = 1; d <= 4; d++) {
    const [dx, dy] = BOMBER_DIRS[d];
    for (let i = 1; i <= b.fire; i++) {
      const k = idx(b.x + dx * i, b.y + dy * i);
      const c = round.grid[k];
      if (c === undefined || isSolidTile(c)) break;
      out.push(k);
      if (isBomberItem(c) || bombAt.has(k)) break;
    }
  }
  return out;
}

/** Seconds until each tile is hit by fire (INF = safe). */
export function computeDanger(
  round: BomberRound,
  extra: DangerBomb | null = null,
): Float32Array {
  const danger = new Float32Array(N).fill(INF);
  const bombs: DangerBomb[] = round.bombs
    .filter((b) => b.held === null)
    .map((b) => ({
      x: Math.round(b.fly ? b.fly.tx : b.x),
      y: Math.round(b.fly ? b.fly.ty : b.y),
      fire: b.fire,
      t: b.remote ? 0.8 : Math.max(0, b.fuse) + (b.fly ? 0.3 : 0),
    }));
  if (extra) bombs.push(extra);
  const byTile = new Map(bombs.map((b) => [idx(b.x, b.y), b]));
  const tiles = new Set(byTile.keys());
  // Chain reactions: a bomb in range goes off with the earlier one.
  for (let pass = 0; pass < 4; pass++)
    for (const b of bombs)
      for (const k of rays(round, b, tiles)) {
        const o = byTile.get(k);
        if (o && o.t > b.t) o.t = b.t;
      }
  for (const b of bombs)
    for (const k of rays(round, b, tiles)) danger[k] = Math.min(danger[k], b.t);
  for (const [k, f] of round.flames) danger[k] = Math.min(danger[k], -f.t);
  for (const d of round.drops)
    danger[idx(d.x, d.y)] = Math.min(danger[idx(d.x, d.y)], d.t);
  if (round.spiral)
    round.spiral.slice(0, 8).forEach(([x, y], i) => {
      const at = round.dropTimer + i * round.dropInterval;
      danger[idx(x, y)] = Math.min(danger[idx(x, y)], at);
    });
  return danger;
}

function walkable(round: BomberRound, k: number, start: number): boolean {
  if (isSolidTile(round.grid[k])) return false;
  return k === start || !round.bombAt(xOf(k), yOf(k));
}

/** BFS over tiles we can reach in time; `strict` only walks fully safe tiles. */
function bfs(
  round: BomberRound,
  start: number,
  danger: Float32Array,
  speed: number,
  strict = false,
) {
  const prev = new Int16Array(N).fill(-1);
  const dist = new Int16Array(N).fill(-1);
  dist[start] = 0;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head];
    for (let d = 1; d <= 4; d++) {
      const nk = idx(xOf(k) + BOMBER_DIRS[d][0], yOf(k) + BOMBER_DIRS[d][1]);
      if (dist[nk] !== -1 || !walkable(round, nk, start)) continue;
      const dz = danger[nk];
      if (dz <= 0) continue; // on fire right now
      const leave = (dist[k] + 2) / speed;
      if (dz !== INF && (strict || leave > dz - 0.15)) continue;
      dist[nk] = dist[k] + 1;
      prev[nk] = k;
      queue.push(nk);
    }
  }
  return { prev, dist };
}

function firstStep(prev: Int16Array, start: number, goal: number): number {
  let k = goal;
  while (prev[k] !== -1 && prev[k] !== start) k = prev[k];
  return prev[k] === start ? k : -1;
}

function dirTo(from: number, to: number): number {
  const dx = xOf(to) - xOf(from);
  const dy = yOf(to) - yOf(from);
  if (dx > 0) return 4;
  if (dx < 0) return 3;
  return dy > 0 ? 2 : 1;
}

const fireOf = (p: RoundPlayer) => (p.curse === 'lowfire' ? 1 : p.fire);

function canEscape(
  round: BomberRound,
  p: RoundPlayer,
  start: number,
  speed: number,
): boolean {
  const extra = {
    x: xOf(start),
    y: yOf(start),
    fire: fireOf(p),
    t: p.remote ? 0.8 : BOMBER_FUSE,
  };
  const danger = computeDanger(round, extra);
  const { dist } = bfs(round, start, danger, speed);
  for (let k = 0; k < N; k++)
    if (dist[k] > 0 && danger[k] === INF && dist[k] / speed < BOMBER_FUSE - 0.5)
      return true;
  return false;
}

/** Soft blocks and enemies a bomb at `start` would reach. */
function hits(round: BomberRound, p: RoundPlayer, start: number) {
  let soft = 0;
  let enemy = false;
  for (let d = 1; d <= 4; d++) {
    const [dx, dy] = BOMBER_DIRS[d];
    for (let i = 1; i <= fireOf(p); i++) {
      const x = xOf(start) + dx * i;
      const y = yOf(start) + dy * i;
      const c = round.grid[idx(x, y)];
      if (c === BOMBER_TILE.SOFT) {
        soft++;
        break;
      }
      if (c === undefined || isSolidTile(c)) break;
      if (
        round.players.some(
          (o) =>
            o.alive &&
            o !== p &&
            Math.round(o.x) === x &&
            Math.round(o.y) === y,
        )
      )
        enemy = true;
    }
  }
  return { soft, enemy };
}

function centerUp(p: RoundPlayer): number {
  const tx = Math.round(p.x);
  const ty = Math.round(p.y);
  if (Math.abs(p.x - tx) > 0.06) return p.x < tx ? 4 : 3;
  if (Math.abs(p.y - ty) > 0.06) return p.y < ty ? 2 : 1;
  return 0;
}

function flee(
  round: BomberRound,
  p: RoundPlayer,
  here: number,
  danger: Float32Array,
  speed: number,
): number {
  const { prev, dist } = bfs(round, here, danger, speed);
  let best = -1;
  for (let k = 0; k < N; k++)
    if (dist[k] >= 0 && danger[k] === INF && (best < 0 || dist[k] < dist[best]))
      best = k;
  if (best < 0)
    for (let k = 0; k < N; k++)
      if (dist[k] >= 0 && (best < 0 || danger[k] > danger[best])) best = k;
  if (best === here) return centerUp(p);
  const step = firstStep(prev, here, best);
  return step >= 0 ? dirTo(here, step) : 0;
}

function pickGoal(
  round: BomberRound,
  p: RoundPlayer,
  dist: Int16Array,
  speed: number,
): void {
  const ai = p.ai;
  const cands: { k: number; score: number; bombSpot: boolean }[] = [];
  for (let k = 0; k < N; k++) {
    if (dist[k] < 0) continue;
    const c = round.grid[k];
    let score = -dist[k] * 1.2 + round.rand() * 2;
    let bombSpot = false;
    if (isBomberItem(c)) score += c === BOMBER_ITEMS.SKULL ? -40 : 22;
    else {
      const hit = hits(round, p, k);
      if (hit.enemy) score += 14;
      if (hit.soft) score += 6 + hit.soft * 2;
      bombSpot = hit.enemy || hit.soft > 0;
    }
    // Drift toward opponents as the arena opens up.
    let nearest = INF;
    for (const o of round.players)
      if (o !== p && o.alive)
        nearest = Math.min(
          nearest,
          Math.abs(o.x - xOf(k)) + Math.abs(o.y - yOf(k)),
        );
    if (nearest < INF) score -= nearest * 0.25;
    cands.push({ k, score, bombSpot });
  }
  cands.sort((a, b) => b.score - a.score);
  ai.goal = null;
  for (const c of cands.slice(0, 12)) {
    if (c.bombSpot && !canEscape(round, p, c.k, speed)) continue;
    ai.goal = c.k;
    ai.goalBomb = c.bombSpot;
    return;
  }
}

/**
 * CPU opponent: runs from danger, picks up items, bombs blocks and players
 * only when it can still escape the blast.
 */
export function botThink(round: BomberRound, p: RoundPlayer): RoundInput {
  const ai = p.ai;
  const speed = round.speedOf(p);
  const here = idx(Math.round(p.x), Math.round(p.y));
  const danger = computeDanger(round);
  const out: RoundInput = { d: 0, b: false, a: false };

  if (danger[here] !== INF) {
    ai.goal = null;
    out.d = flee(round, p, here, danger, speed);
    return out;
  }

  // Safe now: set off our remote bombs every few ticks.
  if (p.remote && round.bombs.some((b) => b.owner === p.seat && b.remote))
    out.a = (round.tickN + p.seat) % 9 === 0;

  ai.cool = (ai.cool ?? 0) - BOMBER_DT;
  const canBomb =
    round.activeBombs(p) < p.bombs &&
    p.curse !== 'nobomb' &&
    !round.bombAt(xOf(here), yOf(here));
  const centered =
    Math.abs(p.x - xOf(here)) < 0.2 && Math.abs(p.y - yOf(here)) < 0.2;
  if (canBomb && centered && ai.cool <= 0) {
    const hit = hits(round, p, here);
    const atGoal = ai.goal === here && ai.goalBomb;
    const wants =
      hit.enemy || (hit.soft > 0 && (atGoal || round.rand() < 0.08));
    if (wants && canEscape(round, p, here, speed)) {
      out.b = true;
      ai.cool = 0.35 + round.rand() * 0.4;
      ai.goal = null;
      return out;
    }
  }

  const { prev, dist } = bfs(round, here, danger, speed, true);
  ai.repick = (ai.repick ?? 0) - BOMBER_DT;
  if (ai.goal == null || dist[ai.goal] < 0 || ai.repick <= 0) {
    ai.repick = 1.2 + round.rand();
    pickGoal(round, p, dist, speed);
  }
  if (ai.goal == null || ai.goal === here) {
    out.d = centerUp(p);
    return out;
  }
  const step = firstStep(prev, here, ai.goal);
  out.d = step >= 0 ? dirTo(here, step) : centerUp(p);
  return out;
}

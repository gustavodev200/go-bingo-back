import {
  BOMBER_BASE_SPEED,
  BOMBER_BURN_TIME,
  BOMBER_COLS,
  BOMBER_COUNTDOWN,
  BOMBER_CURSE_TIME,
  BOMBER_CURSES,
  BOMBER_DIRS,
  BOMBER_DROP_FALL_TIME,
  BOMBER_DT,
  BOMBER_FLAME_TIME,
  BOMBER_FUSE,
  BOMBER_ITEMS,
  BOMBER_KICK_SPEED,
  BOMBER_MAX_BOMBS,
  BOMBER_MAX_FIRE,
  BOMBER_MAX_SPEED_UPS,
  BOMBER_OPPOSITE,
  BOMBER_ROUND_TIME,
  BOMBER_ROWS,
  BOMBER_SPAWNS,
  BOMBER_SPEED_STEP,
  BOMBER_SUDDEN_DEATH_AT,
  BOMBER_THROW_DIST,
  BOMBER_THROW_TIME,
  BOMBER_TILE,
  isBomberItem,
  isSolidTile,
  movePlayer,
  type BomberCurse,
  type BomberDir,
  type BomberFlameKind,
  type BomberFrame,
  type BomberFrameEvent,
  type BomberItem,
  type BomberRoundPhase,
  type BomberWorld,
} from '../../contracts';
import { botThink, type BotMemory } from './bot';

/** Uniform float in [0, 1). Injected so rounds are reproducible in tests. */
export type Rand = () => number;

export interface RoundInput {
  d: number;
  b: boolean;
  a: boolean;
  /** Client sequence number (absent for bots). */
  s?: number;
}

export interface RoundPlayer {
  seat: number;
  bot: boolean;
  x: number;
  y: number;
  dir: BomberDir;
  moving: boolean;
  alive: boolean;
  bombs: number;
  fire: number;
  speedUps: number;
  kick: boolean;
  glove: boolean;
  remote: boolean;
  curse: BomberCurse | null;
  curseT: number;
  queue: RoundInput[];
  lastSeq: number;
  prevBomb: boolean;
  prevAction: boolean;
  holding: number | null;
  collected: BomberItem[];
  ai: BotMemory;
}

export interface RoundBomb {
  id: number;
  owner: number;
  x: number;
  y: number;
  fire: number;
  fuse: number;
  remote: boolean;
  /** Direction it is sliding after a kick (0 = still). */
  slide: number;
  fly: {
    fx: number;
    fy: number;
    tx: number;
    ty: number;
    dx: number;
    dy: number;
    t: number;
    dur: number;
  } | null;
  /** Seat holding it with the glove, or null. */
  held: number | null;
  exploded?: boolean;
}

interface Flame {
  t: number;
  kind: BomberFlameKind;
}

export interface RoundResult {
  /** Surviving seat, or null for a draw. */
  winner: number | null;
}

const ITEM_WEIGHTS: [BomberItem, number][] = [
  [BOMBER_ITEMS.BOMB, 15],
  [BOMBER_ITEMS.FIRE, 15],
  [BOMBER_ITEMS.SPEED, 9],
  [BOMBER_ITEMS.KICK, 6],
  [BOMBER_ITEMS.GLOVE, 5],
  [BOMBER_ITEMS.SKULL, 5],
  [BOMBER_ITEMS.MAXFIRE, 2],
  [BOMBER_ITEMS.REMOTE, 3],
];
const ITEM_CHANCE = 0.4;
const SOFT_DENSITY = 0.8;
const END_GRACE = 1.6;
const MAX_QUEUE = 8;

const r2 = (v: number) => Math.round(v * 100) / 100;
export const tileIndex = (x: number, y: number) => y * BOMBER_COLS + x;

function pickItem(rand: Rand): BomberItem {
  const total = ITEM_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let n = rand() * total;
  for (const [c, w] of ITEM_WEIGHTS) if ((n -= w) < 0) return c;
  return BOMBER_ITEMS.BOMB;
}

/** Hard pillars on even tiles, soft blocks everywhere else except next to the used spawns. */
export function generateMap(spawnCount: number, rand: Rand): string[] {
  const grid = new Array<string>(BOMBER_COLS * BOMBER_ROWS).fill(
    BOMBER_TILE.FLOOR,
  );
  const safe = new Set<number>();
  for (const [sx, sy] of BOMBER_SPAWNS.slice(0, spawnCount))
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      safe.add(tileIndex(sx + dx, sy + dy));
  for (let y = 0; y < BOMBER_ROWS; y++)
    for (let x = 0; x < BOMBER_COLS; x++) {
      const border =
        x === 0 || y === 0 || x === BOMBER_COLS - 1 || y === BOMBER_ROWS - 1;
      if (border || (x % 2 === 0 && y % 2 === 0))
        grid[tileIndex(x, y)] = BOMBER_TILE.HARD;
      else if (!safe.has(tileIndex(x, y)) && rand() < SOFT_DENSITY)
        grid[tileIndex(x, y)] = BOMBER_TILE.SOFT;
    }
  return grid;
}

/** Interior tiles as an inward spiral: the sudden-death drop order. */
export function spiralOrder(): [number, number][] {
  const out: [number, number][] = [];
  let x0 = 1;
  let y0 = 1;
  let x1 = BOMBER_COLS - 2;
  let y1 = BOMBER_ROWS - 2;
  while (x0 <= x1 && y0 <= y1) {
    for (let x = x0; x <= x1; x++) out.push([x, y0]);
    for (let y = y0 + 1; y <= y1; y++) out.push([x1, y]);
    if (y0 < y1) for (let x = x1 - 1; x >= x0; x--) out.push([x, y1]);
    if (x0 < x1) for (let y = y1 - 1; y > y0; y--) out.push([x0, y]);
    x0++;
    y0++;
    x1--;
    y1--;
  }
  return out;
}

/**
 * One battle round, simulated at a fixed step. Pure game rules: no transport,
 * no wall clock. Players are identified by seat.
 */
export class BomberRound {
  readonly grid: string[];
  readonly players: RoundPlayer[];
  bombs: RoundBomb[] = [];
  readonly flames = new Map<number, Flame>();
  readonly burning = new Map<number, number>();
  drops: { x: number; y: number; t: number }[] = [];
  spiral: [number, number][] | null = null;
  dropTimer = 0;
  dropInterval = 0;
  time = BOMBER_ROUND_TIME;
  phase: BomberRoundPhase = 'countdown';
  phaseT = BOMBER_COUNTDOWN;
  tickN = 0;
  result: RoundResult | null = null;
  private events: BomberFrameEvent[] = [];
  private nextBombId = 1;
  readonly world: BomberWorld;

  constructor(
    readonly roundNumber: number,
    /** Seats in spawn order. */
    participants: { seat: number; bot: boolean }[],
    readonly rand: Rand,
  ) {
    this.grid = generateMap(participants.length, rand);
    this.players = participants.map(({ seat, bot }, i) => {
      const [x, y] = BOMBER_SPAWNS[i];
      return {
        seat,
        bot,
        x,
        y,
        dir: 2,
        moving: false,
        alive: true,
        bombs: 1,
        fire: 2,
        speedUps: 0,
        kick: false,
        glove: false,
        remote: false,
        curse: null,
        curseT: 0,
        queue: [],
        lastSeq: 0,
        prevBomb: false,
        prevAction: false,
        holding: null,
        collected: [],
        ai: {},
      };
    });
    this.world = { grid: this.grid, bombAt: (x, y) => this.bombAt(x, y) };
  }

  player(seat: number): RoundPlayer | undefined {
    return this.players.find((p) => p.seat === seat);
  }

  bombAt(tx: number, ty: number): RoundBomb | null {
    for (const b of this.bombs)
      if (
        !b.fly &&
        b.held === null &&
        Math.round(b.x) === tx &&
        Math.round(b.y) === ty
      )
        return b;
    return null;
  }

  speedOf(p: RoundPlayer): number {
    if (p.curse === 'slow') return 1.7;
    if (p.curse === 'fast') return 8.5;
    return BOMBER_BASE_SPEED + BOMBER_SPEED_STEP * p.speedUps;
  }

  activeBombs(p: RoundPlayer): number {
    return this.bombs.filter((b) => b.owner === p.seat).length;
  }

  pushInput(seat: number, input: RoundInput): void {
    const p = this.player(seat);
    if (!p || p.bot || !p.alive) return;
    p.queue.push(input);
    if (p.queue.length > MAX_QUEUE)
      p.queue.splice(0, p.queue.length - MAX_QUEUE);
  }

  /** Takes a player out (left the room): dies on the spot without scattering a fight. */
  remove(seat: number): void {
    const p = this.player(seat);
    if (p?.alive) this.kill(p, 'left');
  }

  private emit(e: BomberFrameEvent): void {
    this.events.push(e);
  }

  tick(): void {
    const dt = BOMBER_DT;
    this.tickN++;
    if (this.phase === 'over') return;
    if (this.phase === 'countdown') {
      this.phaseT -= dt;
      for (const p of this.players) {
        p.queue.length = 0;
        p.moving = false;
      }
      if (this.phaseT <= 0) {
        this.phase = 'play';
        this.emit({ k: 'go' });
      }
      return;
    }

    this.time = Math.max(0, this.time - dt);
    for (const p of this.players) {
      if (!p.alive) {
        p.queue.length = 0;
        continue;
      }
      if (p.bot) {
        this.applyInput(p, botThink(this, p), dt);
        continue;
      }
      // One input per tick; two while the client is ahead so lag catches up.
      const n = p.queue.length > 3 ? 2 : 1;
      let did = false;
      for (let i = 0; i < n && p.queue.length; i++) {
        const input = p.queue.shift()!;
        p.lastSeq = input.s ?? p.lastSeq;
        this.applyInput(p, input, dt);
        did = true;
      }
      if (!did) p.moving = false;
    }

    this.updateBombs(dt);
    this.updateFlames(dt);
    this.updateSuddenDeath(dt);
    this.updateCurses(dt);
    this.checkDeaths();
    this.checkEnd(dt);
  }

  private applyInput(p: RoundPlayer, input: RoundInput, dt: number): void {
    let dir = (input.d >= 0 && input.d <= 4 ? input.d : 0) as BomberDir;
    if (p.curse === 'reverse' && dir) dir = BOMBER_OPPOSITE[dir];
    p.moving = dir !== 0;
    if (dir) {
      p.dir = dir;
      const blocked = movePlayer(this.world, p, dir, this.speedOf(p) * dt);
      if (blocked && p.kick) this.tryKick(blocked, dir);
    }
    this.pickupItem(p);

    const bombEdge = input.b && !p.prevBomb;
    const actionEdge = input.a && !p.prevAction;
    p.prevBomb = input.b;
    p.prevAction = input.a;
    if (bombEdge || p.curse === 'diarrhea') this.placeBomb(p);
    if (actionEdge) this.action(p);
  }

  private tryKick([tx, ty]: [number, number], dir: BomberDir): void {
    const b = this.bombAt(tx, ty);
    if (!b || b.slide) return;
    const [dx, dy] = BOMBER_DIRS[dir];
    if (this.bombBlocked(b.x + dx, b.y + dy)) return;
    b.slide = dir;
    this.emit({ k: 'kick' });
  }

  placeBomb(p: RoundPlayer): boolean {
    if (p.holding !== null || p.curse === 'nobomb') return false;
    if (this.activeBombs(p) >= p.bombs) return false;
    const tx = Math.round(p.x);
    const ty = Math.round(p.y);
    if (this.bombAt(tx, ty) || this.flames.has(tileIndex(tx, ty))) return false;
    this.bombs.push({
      id: this.nextBombId++,
      owner: p.seat,
      x: tx,
      y: ty,
      fire: p.curse === 'lowfire' ? 1 : p.fire,
      fuse: BOMBER_FUSE,
      remote: p.remote,
      slide: 0,
      fly: null,
      held: null,
    });
    this.emit({ k: 'place' });
    return true;
  }

  /** Action button: throw what you hold, pick up the bomb under you, or detonate a remote bomb. */
  private action(p: RoundPlayer): void {
    const [dx, dy] = BOMBER_DIRS[p.dir || 2];
    if (p.holding !== null) {
      const b = this.bombs.find((bb) => bb.id === p.holding);
      p.holding = null;
      if (!b) return;
      b.held = null;
      const fx = Math.round(p.x);
      const fy = Math.round(p.y);
      b.x = fx;
      b.y = fy;
      b.fly = {
        fx,
        fy,
        tx: fx + dx * BOMBER_THROW_DIST,
        ty: fy + dy * BOMBER_THROW_DIST,
        dx,
        dy,
        t: 0,
        dur: BOMBER_THROW_TIME,
      };
      this.emit({ k: 'throw' });
      return;
    }
    if (p.glove) {
      const b = this.bombAt(Math.round(p.x), Math.round(p.y));
      if (b && !b.slide) {
        b.held = p.seat;
        p.holding = b.id;
        this.emit({ k: 'pick' });
        return;
      }
    }
    if (p.remote) {
      const mine = this.bombs.find(
        (b) => b.owner === p.seat && b.remote && !b.fly && b.held === null,
      );
      if (mine) this.explode(mine);
    }
  }

  private pickupItem(p: RoundPlayer): void {
    const i = tileIndex(Math.round(p.x), Math.round(p.y));
    const c = this.grid[i];
    if (!isBomberItem(c)) return;
    this.grid[i] = BOMBER_TILE.FLOOR;
    switch (c) {
      case BOMBER_ITEMS.BOMB:
        p.bombs = Math.min(BOMBER_MAX_BOMBS, p.bombs + 1);
        break;
      case BOMBER_ITEMS.FIRE:
        p.fire = Math.min(BOMBER_MAX_FIRE, p.fire + 1);
        break;
      case BOMBER_ITEMS.SPEED:
        p.speedUps = Math.min(BOMBER_MAX_SPEED_UPS, p.speedUps + 1);
        break;
      case BOMBER_ITEMS.KICK:
        p.kick = true;
        break;
      case BOMBER_ITEMS.GLOVE:
        p.glove = true;
        break;
      case BOMBER_ITEMS.REMOTE:
        p.remote = true;
        break;
      case BOMBER_ITEMS.MAXFIRE:
        p.fire = BOMBER_MAX_FIRE;
        break;
      case BOMBER_ITEMS.SKULL:
        p.curse = BOMBER_CURSES[Math.floor(this.rand() * BOMBER_CURSES.length)];
        p.curseT = BOMBER_CURSE_TIME;
        this.emit({ k: 'item', seat: p.seat, c, curse: p.curse });
        return;
    }
    p.collected.push(c);
    this.emit({ k: 'item', seat: p.seat, c });
  }

  bombBlocked(x: number, y: number, self: RoundBomb | null = null): boolean {
    const tx = Math.round(x);
    const ty = Math.round(y);
    if (tx < 0 || ty < 0 || tx >= BOMBER_COLS || ty >= BOMBER_ROWS) return true;
    if (isSolidTile(this.grid[tileIndex(tx, ty)])) return true;
    const other = this.bombAt(tx, ty);
    if (other && other !== self) return true;
    return this.players.some(
      (p) => p.alive && Math.round(p.x) === tx && Math.round(p.y) === ty,
    );
  }

  private updateBombs(dt: number): void {
    for (const b of [...this.bombs]) {
      if (b.exploded) continue;
      if (b.held !== null) {
        const h = this.player(b.held);
        if (h) {
          b.x = Math.round(h.x);
          b.y = Math.round(h.y);
        }
        continue; // the fuse stops while held
      }
      if (b.fly) {
        this.updateFlight(b, dt);
        continue;
      }
      if (b.slide) this.updateSlide(b, dt);
      if (!b.remote) b.fuse -= dt;
      if (
        b.fuse <= 0 ||
        this.flames.has(tileIndex(Math.round(b.x), Math.round(b.y)))
      )
        this.explode(b);
    }
  }

  private updateSlide(b: RoundBomb, dt: number): void {
    const [dx, dy] = BOMBER_DIRS[b.slide];
    const cx = Math.round(b.x);
    const cy = Math.round(b.y);
    const nx = b.x + dx * BOMBER_KICK_SPEED * dt;
    const ny = b.y + dy * BOMBER_KICK_SPEED * dt;
    const pastCenter = (nx - cx) * dx + (ny - cy) * dy >= 0;
    if (pastCenter && this.bombBlocked(cx + dx, cy + dy, b)) {
      b.x = cx;
      b.y = cy;
      b.slide = 0;
    } else {
      b.x = nx;
      b.y = ny;
    }
  }

  private updateFlight(b: RoundBomb, dt: number): void {
    const f = b.fly!;
    f.t += dt;
    if (f.t < f.dur) return;
    // Thrown bombs wrap around the arena interior.
    const w = BOMBER_COLS - 2;
    const h = BOMBER_ROWS - 2;
    const tx = ((((f.tx - 1) % w) + w) % w) + 1;
    const ty = ((((f.ty - 1) % h) + h) % h) + 1;
    b.x = tx;
    b.y = ty;
    if (isSolidTile(this.grid[tileIndex(tx, ty)]) || this.bombAt(tx, ty)) {
      b.fly = {
        fx: tx,
        fy: ty,
        tx: tx + f.dx,
        ty: ty + f.dy,
        dx: f.dx,
        dy: f.dy,
        t: 0,
        dur: 0.18,
      };
      this.emit({ k: 'bounce' });
      return;
    }
    b.fly = null;
    b.fuse = Math.max(b.fuse, 0.8);
    this.emit({ k: 'land' });
  }

  explode(first: RoundBomb): void {
    const queue = [first];
    while (queue.length) {
      const b = queue.pop()!;
      if (b.exploded) continue;
      b.exploded = true;
      this.bombs.splice(this.bombs.indexOf(b), 1);
      if (b.held !== null) {
        const h = this.player(b.held);
        if (h) h.holding = null;
      }
      const bx = Math.round(b.x);
      const by = Math.round(b.y);
      this.addFlame(bx, by, 'c');
      for (let dir = 1; dir <= 4; dir++) this.ray(b, bx, by, dir, queue);
      this.emit({ k: 'boom', x: bx, y: by });
    }
  }

  private ray(
    b: RoundBomb,
    bx: number,
    by: number,
    dir: number,
    queue: RoundBomb[],
  ): void {
    const [dx, dy] = BOMBER_DIRS[dir];
    for (let i = 1; i <= b.fire; i++) {
      const x = bx + dx * i;
      const y = by + dy * i;
      const k = tileIndex(x, y);
      const c = this.grid[k];
      // The arena border is hard, so rays never leave the grid.
      if (c === BOMBER_TILE.HARD || c === BOMBER_TILE.BURNING) return;
      if (c === BOMBER_TILE.SOFT) {
        this.grid[k] = BOMBER_TILE.BURNING;
        this.burning.set(k, BOMBER_BURN_TIME);
        return;
      }
      const end = i === b.fire;
      this.addFlame(
        x,
        y,
        end ? ('xudlr'[dir] as BomberFlameKind) : dx ? 'h' : 'v',
      );
      if (isBomberItem(c)) {
        this.grid[k] = BOMBER_TILE.FLOOR;
        this.emit({ k: 'burnItem', x, y });
        return;
      }
      const other = this.bombAt(x, y);
      if (other) {
        queue.push(other);
        return;
      }
    }
  }

  private addFlame(x: number, y: number, kind: BomberFlameKind): void {
    const k = tileIndex(x, y);
    const prev = this.flames.get(k);
    let next = kind;
    if (prev && prev.kind !== kind) {
      const H = 'hlr';
      const V = 'vud';
      if (H.includes(prev.kind) && H.includes(kind)) next = 'h';
      else if (V.includes(prev.kind) && V.includes(kind)) next = 'v';
      else next = 'c';
    }
    this.flames.set(k, { t: BOMBER_FLAME_TIME, kind: next });
  }

  private updateFlames(dt: number): void {
    for (const [k, f] of this.flames) {
      f.t -= dt;
      if (f.t <= 0) this.flames.delete(k);
    }
    for (const [k, t] of this.burning) {
      if (t - dt > 0) {
        this.burning.set(k, t - dt);
        continue;
      }
      this.burning.delete(k);
      this.grid[k] =
        this.rand() < ITEM_CHANCE ? pickItem(this.rand) : BOMBER_TILE.FLOOR;
    }
  }

  private updateSuddenDeath(dt: number): void {
    if (this.time <= BOMBER_SUDDEN_DEATH_AT && !this.spiral) {
      this.spiral = spiralOrder().filter(
        ([x, y]) => this.grid[tileIndex(x, y)] !== BOMBER_TILE.HARD,
      );
      this.dropInterval = (BOMBER_SUDDEN_DEATH_AT - 6) / this.spiral.length;
      this.dropTimer = 0;
      this.emit({ k: 'hurry' });
    }
    if (this.spiral?.length) {
      this.dropTimer -= dt;
      while (this.dropTimer <= 0 && this.spiral.length) {
        this.dropTimer += this.dropInterval;
        const [x, y] = this.spiral.shift()!;
        if (this.grid[tileIndex(x, y)] === BOMBER_TILE.HARD) continue;
        this.drops.push({ x, y, t: BOMBER_DROP_FALL_TIME });
        this.emit({ k: 'drop', x, y });
      }
    }
    for (const d of [...this.drops]) {
      d.t -= dt;
      if (d.t > 0) continue;
      this.drops.splice(this.drops.indexOf(d), 1);
      this.land(d.x, d.y);
    }
  }

  /** A falling block lands: crushes whoever is there and swallows bombs. */
  private land(x: number, y: number): void {
    const k = tileIndex(x, y);
    this.grid[k] = BOMBER_TILE.HARD;
    this.flames.delete(k);
    this.burning.delete(k);
    this.bombs = this.bombs.filter((b) => {
      const hit =
        !b.fly &&
        b.held === null &&
        Math.round(b.x) === x &&
        Math.round(b.y) === y;
      if (hit) b.exploded = true;
      return !hit;
    });
    for (const p of this.players)
      if (p.alive && Math.round(p.x) === x && Math.round(p.y) === y)
        this.kill(p, 'crush');
    this.emit({ k: 'thud', x, y });
  }

  private updateCurses(dt: number): void {
    const alive = this.players.filter((p) => p.alive);
    for (const p of alive) {
      if (!p.curse) continue;
      p.curseT -= dt;
      if (p.curseT <= 0) {
        p.curse = null;
        continue;
      }
      // Touching someone passes the curse on.
      for (const o of alive) {
        if (o === p || o.curse) continue;
        if (Math.abs(o.x - p.x) < 0.7 && Math.abs(o.y - p.y) < 0.7) {
          o.curse = p.curse;
          o.curseT = BOMBER_CURSE_TIME;
          this.emit({
            k: 'item',
            seat: o.seat,
            c: BOMBER_ITEMS.SKULL,
            curse: o.curse,
          });
        }
      }
    }
  }

  private checkDeaths(): void {
    for (const p of this.players)
      if (
        p.alive &&
        this.flames.has(tileIndex(Math.round(p.x), Math.round(p.y)))
      )
        this.kill(p, 'fire');
  }

  kill(p: RoundPlayer, cause: 'fire' | 'crush' | 'left'): void {
    p.alive = false;
    p.moving = false;
    p.curse = null;
    p.queue.length = 0;
    this.emit({ k: 'die', seat: p.seat, cause });
    if (p.holding !== null) {
      const b = this.bombs.find((bb) => bb.id === p.holding);
      if (b) {
        b.held = null;
        b.x = Math.round(p.x);
        b.y = Math.round(p.y);
        b.fuse = Math.min(b.fuse, 0.4);
      }
      p.holding = null;
    }
    for (const b of this.bombs)
      if (b.owner === p.seat && b.remote) {
        b.remote = false;
        b.fuse = Math.min(b.fuse, 0.6);
      }
    this.scatterItems(p.collected);
    p.collected = [];
  }

  /** The dead player's power-ups land on random free floor tiles. */
  private scatterItems(items: BomberItem[]): void {
    if (this.spiral) return; // the arena is closing: nothing comes back
    const free: number[] = [];
    for (let y = 1; y < BOMBER_ROWS - 1; y++)
      for (let x = 1; x < BOMBER_COLS - 1; x++) {
        const k = tileIndex(x, y);
        if (this.grid[k] !== BOMBER_TILE.FLOOR || this.flames.has(k)) continue;
        if (this.bombAt(x, y)) continue;
        if (
          this.players.some(
            (p) => p.alive && Math.round(p.x) === x && Math.round(p.y) === y,
          )
        )
          continue;
        free.push(k);
      }
    for (const c of items) {
      if (!free.length) return;
      const k = free.splice(Math.floor(this.rand() * free.length), 1)[0];
      this.grid[k] = c;
    }
  }

  private checkEnd(dt: number): void {
    const alive = this.players.filter((p) => p.alive);
    if (this.phase === 'play' && (alive.length <= 1 || this.time <= 0)) {
      this.phase = 'ending';
      this.phaseT = this.time <= 0 ? 0 : END_GRACE;
    }
    if (this.phase !== 'ending') return;
    this.phaseT -= dt;
    if (this.phaseT > 0) return;
    this.phase = 'over';
    this.result = { winner: alive.length === 1 ? alive[0].seat : null };
  }

  /** Public view for this tick; drains the events collected since the last frame. */
  frame(): BomberFrame {
    const frame: BomberFrame = {
      roundNumber: this.roundNumber,
      phase: this.phase,
      phaseLeft: r2(Math.max(0, this.phaseT)),
      timeLeft: Math.ceil(this.time),
      grid: this.grid.join(''),
      players: this.players.map((p) => [
        p.seat,
        r2(p.x),
        r2(p.y),
        p.dir,
        p.moving ? 1 : 0,
        p.alive ? 1 : 0,
        r2(this.speedOf(p)),
        p.curse ?? 0,
        p.lastSeq,
        p.holding !== null ? 1 : 0,
        p.bombs,
        p.fire,
        p.speedUps,
        (p.kick ? 1 : 0) | (p.glove ? 2 : 0) | (p.remote ? 4 : 0),
      ]),
      bombs: this.bombs.map((b) => [
        b.id,
        r2(b.x),
        r2(b.y),
        b.remote ? 1 : 0,
        b.fly
          ? [
              b.fly.fx,
              b.fly.fy,
              b.fly.tx,
              b.fly.ty,
              r2(Math.min(1, b.fly.t / b.fly.dur)),
            ]
          : 0,
        b.held ?? -1,
        b.remote ? 1 : r2(Math.max(0, b.fuse) / BOMBER_FUSE),
      ]),
      flames: [...this.flames].map(([k, f]) => [
        k,
        f.kind,
        r2(f.t / BOMBER_FLAME_TIME),
      ]),
      drops: this.drops.map((d) => [
        d.x,
        d.y,
        r2(1 - d.t / BOMBER_DROP_FALL_TIME),
      ]),
      events: this.events,
    };
    this.events = [];
    return frame;
  }
}

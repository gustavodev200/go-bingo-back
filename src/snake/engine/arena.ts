import {
  SNAKE_ARENA_RADIUS,
  SNAKE_BASE_SPEED,
  SNAKE_BOOST_MASS_PER_SEC,
  SNAKE_BOOST_SPEED,
  SNAKE_FOOD_COLORS,
  SNAKE_FOOD_MAX,
  SNAKE_FOOD_TARGET,
  SNAKE_MAGNET,
  SNAKE_MIN_BOOST_MASS,
  SNAKE_REMAINS_TTL_MS,
  SNAKE_START_MASS,
  SNAKE_TICK_MS,
  SNAKE_TICK_RATE,
  snakePointsFor,
  snakeRadiusFor,
  snakeSkinFoodColor,
  snakeSpacingFor,
  snakeTurnFor,
  type SnakeFrameFoodIn,
  type SnakeFrameSnakeIn,
} from '../../contracts';

const CELL = 64;
const TAU = Math.PI * 2;
const cellKey = (cx: number, cy: number) => (cx + 2048) * 4096 + (cy + 2048);

export const wrapAngle = (a: number) => {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
};

export type Point = [number, number];

export interface Food {
  id: number;
  x: number;
  y: number;
  v: number;
  c: number;
  /** Tick it disappears; 0 = ambient (never expires). */
  exp: number;
  key: number;
}

export class Snake {
  mass = SNAKE_START_MASS;
  best = SNAKE_START_MASS;
  kills = 0;
  /** Head first. */
  pts: Point[] = [];
  angle = 0;
  target = 0;
  wantBoost = false;
  boosting = false;
  boostAcc = 0;
  alive = true;
  radius = snakeRadiusFor(SNAKE_START_MASS);
  bbox: [number, number, number, number] = [0, 0, 0, 0];

  constructor(
    readonly id: number,
    readonly name: string,
    readonly skin: number,
  ) {}

  get head(): Point {
    return this.pts[0];
  }
}

export type ArenaEvent =
  | { t: 'spawn'; snake: Snake }
  | { t: 'death'; snake: Snake; killer: Snake | null };

export interface ArenaOptions {
  rng?: () => number;
  onEvent?: (ev: ArenaEvent) => void;
  foodTarget?: number;
}

/**
 * Pure simulation of one room's arena: movement, spatial grids, collisions,
 * food and remains. No transport and no clock: `step()` advances one tick.
 */
export class Arena {
  readonly radius = SNAKE_ARENA_RADIUS;
  readonly rng: () => number;
  onEvent: (ev: ArenaEvent) => void;
  private readonly foodTarget: number;
  tick = 0;
  readonly snakes = new Map<number, Snake>();
  readonly foods = new Map<number, Food>();
  private readonly foodGrid = new Map<number, Set<Food>>();
  /** cell -> [snake, pointIndex, snake, pointIndex, ...] */
  private readonly bodyGrid = new Map<number, (Snake | number)[]>();
  private ambientCount = 0;
  private nextSnakeId = 1;
  private nextFoodId = 1;

  constructor(opts: ArenaOptions = {}) {
    this.rng = opts.rng ?? Math.random;
    this.onEvent = opts.onEvent ?? (() => undefined);
    this.foodTarget = opts.foodTarget ?? SNAKE_FOOD_TARGET;
    for (let i = 0; i < this.foodTarget; i++) this.spawnAmbient();
  }

  // ---------- food ----------

  addFood(x: number, y: number, v: number, c: number, ttlMs = 0): Food | null {
    if (this.foods.size >= SNAKE_FOOD_MAX) return null;
    const id = this.nextFoodId++;
    if (this.nextFoodId > 0xfffffff0) this.nextFoodId = 1;
    const f: Food = {
      id,
      x,
      y,
      v,
      c,
      exp: ttlMs ? this.tick + Math.ceil(ttlMs / SNAKE_TICK_MS) : 0,
      key: cellKey(Math.floor(x / CELL), Math.floor(y / CELL)),
    };
    let set = this.foodGrid.get(f.key);
    if (!set) this.foodGrid.set(f.key, (set = new Set()));
    set.add(f);
    this.foods.set(id, f);
    if (!f.exp) this.ambientCount++;
    return f;
  }

  removeFood(f: Food): void {
    if (!this.foods.delete(f.id)) return;
    const set = this.foodGrid.get(f.key);
    if (set) {
      set.delete(f);
      if (!set.size) this.foodGrid.delete(f.key);
    }
    if (!f.exp) this.ambientCount--;
  }

  private spawnAmbient(): void {
    const r = this.radius * 0.97 * Math.sqrt(this.rng());
    const a = this.rng() * TAU;
    const v = 1 + Math.floor(this.rng() * 3) * 0.5;
    this.addFood(
      Math.cos(a) * r,
      Math.sin(a) * r,
      v,
      Math.floor(this.rng() * SNAKE_FOOD_COLORS.length),
    );
  }

  forEachFoodIn(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    cb: (f: Food) => void,
  ): void {
    const cx0 = Math.floor(x0 / CELL);
    const cx1 = Math.floor(x1 / CELL);
    const cy0 = Math.floor(y0 / CELL);
    const cy1 = Math.floor(y1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        const set = this.foodGrid.get(cellKey(cx, cy));
        if (set) for (const f of set) cb(f);
      }
  }

  // ---------- snakes ----------

  private freeSpot(): Point {
    let best: Point = [0, 0];
    let bestD = -1;
    for (let tries = 0; tries < 25; tries++) {
      const r = this.radius * 0.75 * Math.sqrt(this.rng());
      const a = this.rng() * TAU;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      let d = Infinity;
      for (const s of this.snakes.values())
        for (let i = 0; i < s.pts.length; i += 4)
          d = Math.min(d, Math.hypot(s.pts[i][0] - x, s.pts[i][1] - y));
      if (d > 400) return [x, y];
      if (d > bestD) {
        bestD = d;
        best = [x, y];
      }
    }
    return best;
  }

  spawn(
    name: string,
    skin: number,
    at?: Point,
    mass = SNAKE_START_MASS,
  ): Snake {
    let id = this.nextSnakeId;
    while (this.snakes.has(id)) id = (id % 65000) + 1;
    this.nextSnakeId = (id % 65000) + 1;
    const s = new Snake(id, name, skin);
    s.mass = s.best = mass;
    const [x, y] = at ?? this.freeSpot();
    // Face roughly toward the center so nobody spawns heading into the wall.
    s.angle = s.target = Math.atan2(-y, -x) + (this.rng() - 0.5) * 1.5;
    s.radius = snakeRadiusFor(SNAKE_START_MASS);
    const sp = snakeSpacingFor(s.radius);
    const n = snakePointsFor(SNAKE_START_MASS);
    for (let i = 0; i < n; i++)
      s.pts.push([
        x - Math.cos(s.angle) * sp * i,
        y - Math.sin(s.angle) * sp * i,
      ]);
    this.updateBBox(s);
    this.snakes.set(id, s);
    this.onEvent({ t: 'spawn', snake: s });
    return s;
  }

  setInput(id: number, angle: number, boost: boolean): void {
    const s = this.snakes.get(id);
    if (!s || !Number.isFinite(angle)) return;
    s.target = wrapAngle(angle);
    s.wantBoost = boost;
  }

  private updateBBox(s: Snake): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of s.pts) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    s.bbox = [x0 - s.radius, y0 - s.radius, x1 + s.radius, y1 + s.radius];
  }

  private move(s: Snake, dt: number): void {
    const turn = snakeTurnFor(s.radius) * dt * (s.boosting ? 0.85 : 1);
    const diff = wrapAngle(s.target - s.angle);
    s.angle = wrapAngle(s.angle + Math.max(-turn, Math.min(turn, diff)));

    s.boosting = s.wantBoost && s.mass > SNAKE_MIN_BOOST_MASS;
    const speed = s.boosting ? SNAKE_BOOST_SPEED : SNAKE_BASE_SPEED;
    const h = s.pts[0];
    h[0] += Math.cos(s.angle) * speed * dt;
    h[1] += Math.sin(s.angle) * speed * dt;

    if (s.boosting) {
      // Boosting burns mass; it falls behind the tail as pellets.
      const loss = SNAKE_BOOST_MASS_PER_SEC * dt;
      s.mass -= loss;
      s.boostAcc += loss;
      if (s.boostAcc >= 2) {
        const t = s.pts[s.pts.length - 1];
        this.addFood(
          t[0],
          t[1],
          s.boostAcc * 0.8,
          snakeSkinFoodColor(s.skin),
          SNAKE_REMAINS_TTL_MS,
        );
        s.boostAcc = 0;
      }
    }

    s.radius = snakeRadiusFor(s.mass);
    const want = snakePointsFor(s.mass);
    while (s.pts.length < want) {
      const t = s.pts[s.pts.length - 1];
      s.pts.push([t[0], t[1]]);
    }
    if (s.pts.length > want) s.pts.length = want;

    // Each point is pulled behind the previous one at a fixed spacing.
    const sp = snakeSpacingFor(s.radius);
    for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1];
      const b = s.pts[i];
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      const d = Math.hypot(dx, dy);
      if (d > sp) {
        const k = (d - sp) / d;
        b[0] += dx * k;
        b[1] += dy * k;
      }
    }
    this.updateBBox(s);
  }

  private buildBodyGrid(): void {
    this.bodyGrid.clear();
    for (const s of this.snakes.values())
      for (let i = 0; i < s.pts.length; i++) {
        const p = s.pts[i];
        const k = cellKey(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL));
        let arr = this.bodyGrid.get(k);
        if (!arr) this.bodyGrid.set(k, (arr = []));
        arr.push(s, i);
      }
  }

  /** Calls cb(snake, index, x, y) for body points in the cells around (x, y); returning false stops. */
  forEachBodyNear(
    x: number,
    y: number,
    range: number,
    cb: (s: Snake, i: number, px: number, py: number) => boolean | void,
  ): void {
    const cx0 = Math.floor((x - range) / CELL);
    const cx1 = Math.floor((x + range) / CELL);
    const cy0 = Math.floor((y - range) / CELL);
    const cy1 = Math.floor((y + range) / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        const arr = this.bodyGrid.get(cellKey(cx, cy));
        if (!arr) continue;
        for (let j = 0; j < arr.length; j += 2) {
          const s = arr[j] as Snake;
          const p = s.pts[arr[j + 1] as number];
          if (p && cb(s, arr[j + 1] as number, p[0], p[1]) === false) return;
        }
      }
  }

  /** Removes the snake and spreads ~80% of its mass along the body as glowing remains. */
  kill(s: Snake, killer: Snake | null): void {
    if (!s.alive) return;
    s.alive = false;
    this.snakes.delete(s.id);
    const total = Math.max(s.mass - 5, 0) * 0.8;
    const step = Math.max(
      1,
      Math.floor(s.pts.length / Math.max(1, Math.ceil(total / 8))),
    );
    const drops: Point[] = [];
    for (let i = 0; i < s.pts.length; i += step) drops.push(s.pts[i]);
    const each = drops.length ? total / drops.length : 0;
    drops.forEach((p) => {
      let v = each;
      while (v > 0.4) {
        const part = Math.min(v, 20);
        v -= part;
        const j = s.radius * 0.7;
        this.addFood(
          p[0] + (this.rng() - 0.5) * j * 2,
          p[1] + (this.rng() - 0.5) * j * 2,
          part,
          snakeSkinFoodColor(s.skin),
          SNAKE_REMAINS_TTL_MS,
        );
      }
    });
    if (killer?.alive) killer.kills++;
    this.onEvent({ t: 'death', snake: s, killer });
  }

  step(dt = SNAKE_TICK_MS / 1000): void {
    this.tick++;
    const list = [...this.snakes.values()];

    for (const s of list) this.move(s, dt);
    this.buildBodyGrid();

    // A head touching any other snake (body or head) dies; the own body is harmless.
    const dead = new Map<Snake, Snake | null>();
    for (const s of list) {
      const [hx, hy] = s.head;
      if (Math.hypot(hx, hy) + s.radius * 0.6 > this.radius) {
        dead.set(s, null);
        continue;
      }
      const hr = s.radius * 0.8;
      this.forEachBodyNear(hx, hy, hr + 45, (o, i, x, y) => {
        if (o === s) return;
        const rr = hr + o.radius * 0.85;
        const dx = x - hx;
        const dy = y - hy;
        if (dx * dx + dy * dy >= rr * rr) return;
        // Head-on: the clearly bigger one survives (similar sizes both die).
        if (i === 0 && s.mass > o.mass * 1.05) {
          dead.set(o, s);
          return;
        }
        dead.set(s, o);
        return false;
      });
    }

    for (const s of list) {
      if (dead.has(s)) continue;
      const [hx, hy] = s.head;
      const reach = s.radius + SNAKE_MAGNET;
      this.forEachFoodIn(
        hx - reach,
        hy - reach,
        hx + reach,
        hy + reach,
        (f) => {
          const dx = f.x - hx;
          const dy = f.y - hy;
          if (dx * dx + dy * dy <= reach * reach) {
            s.mass += f.v;
            this.removeFood(f);
          }
        },
      );
      if (s.mass > s.best) s.best = s.mass;
    }

    for (const [s, killer] of dead) this.kill(s, killer);

    let n = 0;
    while (this.ambientCount < this.foodTarget && n++ < 40) this.spawnAmbient();
    if (this.tick % SNAKE_TICK_RATE === 0)
      for (const f of this.foods.values())
        if (f.exp && f.exp <= this.tick) this.removeFood(f);
  }

  /** Snakes and food inside a w×h window centered on (cx, cy). */
  viewAt(
    cx: number,
    cy: number,
    w: number,
    h: number,
  ): { snakes: SnakeFrameSnakeIn[]; foods: SnakeFrameFoodIn[] } {
    const x0 = cx - w / 2 - 40;
    const x1 = cx + w / 2 + 40;
    const y0 = cy - h / 2 - 40;
    const y1 = cy + h / 2 + 40;
    const snakes: SnakeFrameSnakeIn[] = [];
    for (const s of this.snakes.values()) {
      const b = s.bbox;
      if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
      const idx: number[] = [];
      const xy: number[] = [];
      const m = s.radius;
      for (let i = 0; i < s.pts.length; i++) {
        const p = s.pts[i];
        if (p[0] < x0 - m || p[0] > x1 + m || p[1] < y0 - m || p[1] > y1 + m)
          continue;
        idx.push(i);
        xy.push(p[0], p[1]);
      }
      if (idx.length)
        snakes.push({
          id: s.id,
          radius: s.radius,
          boost: s.boosting,
          angle: s.angle,
          total: s.pts.length,
          idx,
          xy,
        });
    }
    const foods: SnakeFrameFoodIn[] = [];
    this.forEachFoodIn(x0, y0, x1, y1, (f) => {
      if (f.x >= x0 && f.x <= x1 && f.y >= y0 && f.y <= y1) foods.push(f);
    });
    return { snakes, foods };
  }

  /** Biggest first. */
  ranking(): Snake[] {
    return [...this.snakes.values()].sort((a, b) => b.mass - a.mass);
  }
}

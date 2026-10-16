import {
  SNAKE_ARENA_RADIUS,
  SNAKE_BASE_SPEED,
  SNAKE_BOOST_MASS_PER_SEC,
  SNAKE_MIN_BOOST_MASS,
  SNAKE_SKINS,
  SNAKE_SKIN_NAMES,
  SNAKE_START_MASS,
  SNAKE_TICK_RATE,
  decodeSnakeFrame,
  encodeSnakeFrame,
  snakeFoodColor,
  snakeSkinFoodColor,
} from '../../contracts';
import { Arena, wrapAngle, type ArenaEvent } from './arena';

/** Deterministic PRNG so the bot runs are reproducible. */
function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quiet = () => new Arena({ foodTarget: 0, rng: mulberry(1) });

describe('Snake arena engine', () => {
  it('moves the head forward at base speed', () => {
    const a = quiet();
    const s = a.spawn('A', 0, [0, 0]);
    s.angle = s.target = 0;
    const x0 = s.head[0];
    for (let i = 0; i < SNAKE_TICK_RATE; i++) a.step();
    expect(s.head[0] - x0).toBeCloseTo(SNAKE_BASE_SPEED, 0);
  });

  it('limits how fast the snake turns', () => {
    const a = quiet();
    const s = a.spawn('A', 0, [0, 0]);
    s.angle = 0;
    a.setInput(s.id, Math.PI / 2, false);
    a.step();
    expect(s.angle).toBeGreaterThan(0);
    expect(s.angle).toBeLessThan(Math.PI / 2);
  });

  it('ignores input for unknown snakes or non-finite angles', () => {
    const a = quiet();
    const s = a.spawn('A', 0, [0, 0]);
    s.target = 1;
    a.setInput(s.id, Number.NaN, true);
    a.setInput(999, 2, true);
    expect(s.target).toBe(1);
    expect(s.wantBoost).toBe(false);
  });

  it('grows when eating food', () => {
    const a = quiet();
    const s = a.spawn('A', 0, [0, 0]);
    s.angle = s.target = 0;
    const len = s.pts.length;
    for (let i = 0; i < 20; i++) a.addFood(20 + i * 8, 0, 2.5, 0);
    for (let i = 0; i < 20; i++) a.step();
    expect(a.foods.size).toBe(0);
    expect(s.mass).toBe(SNAKE_START_MASS + 50);
    expect(s.pts.length).toBeGreaterThan(len);
  });

  it('dies on the arena border', () => {
    const events: ArenaEvent[] = [];
    const a = new Arena({ foodTarget: 0, onEvent: (e) => events.push(e) });
    const s = a.spawn('A', 0, [SNAKE_ARENA_RADIUS - 30, 0]);
    s.angle = s.target = 0;
    for (let i = 0; i < 10; i++) a.step();
    expect(s.alive).toBe(false);
    expect(a.snakes.size).toBe(0);
    expect(events.at(-1)).toMatchObject({ t: 'death', killer: null });
  });

  it('kills a head that hits another body, credits the kill and drops remains', () => {
    const events: ArenaEvent[] = [];
    const a = new Arena({
      foodTarget: 0,
      rng: mulberry(2),
      onEvent: (e) => events.push(e),
    });
    const wall = a.spawn('Wall', 1, [0, 300], 200);
    wall.angle = wall.target = 0;
    for (let i = 0; i < 80; i++) a.step();
    const victim = a.spawn('Victim', 2, [wall.pts[10][0], 150], 100);
    victim.angle = victim.target = Math.PI / 2;
    for (let n = 0; victim.alive && n < 60; n++) a.step();
    expect(victim.alive).toBe(false);
    expect(wall.alive).toBe(true);
    expect(wall.kills).toBe(1);
    expect(events.find((e) => e.t === 'death')).toMatchObject({ killer: wall });
    const remains = [...a.foods.values()].reduce((t, f) => t + f.v, 0);
    expect(remains).toBeGreaterThan(50);
    expect([...a.foods.values()].every((f) => f.c >= 128)).toBe(true);
  });

  it('head-on: the clearly bigger snake wins', () => {
    const a = quiet();
    const big = a.spawn('Big', 0, [-60, 0], 300);
    const small = a.spawn('Small', 1, [60, 0], 30);
    big.angle = big.target = 0;
    small.angle = small.target = Math.PI;
    for (let n = 0; small.alive && n < 40; n++) a.step();
    expect(small.alive).toBe(false);
    expect(big.alive).toBe(true);
  });

  it('boost burns mass into pellets and needs a minimum size', () => {
    const a = quiet();
    const s = a.spawn('A', 0, [0, 0], 100);
    a.setInput(s.id, 0, true);
    for (let i = 0; i < SNAKE_TICK_RATE; i++) a.step();
    expect(s.mass).toBeLessThan(100 - SNAKE_BOOST_MASS_PER_SEC * 0.9);
    expect(a.foods.size).toBeGreaterThan(0);
    s.mass = SNAKE_MIN_BOOST_MASS - 1;
    a.step();
    expect(s.boosting).toBe(false);
  });

  it('keeps ambient food topped up and expires remains', () => {
    const a = new Arena({ foodTarget: 50, rng: mulberry(3) });
    expect(a.foods.size).toBe(50);
    const f = a.addFood(0, 0, 3, 0, 1)!;
    for (let i = 0; i < SNAKE_TICK_RATE; i++) a.step();
    expect(a.foods.has(f.id)).toBe(false);
    expect(a.foods.size).toBe(50);
  });

  it('only sends what is inside the viewer window', () => {
    const a = quiet();
    const near = a.spawn('Near', 0, [0, 0]);
    a.spawn('Far', 1, [2000, 2000]);
    a.addFood(10, 10, 1, 0);
    a.addFood(2500, 0, 1, 0);
    const v = a.viewAt(0, 0, 800, 600);
    expect(v.snakes.map((s) => s.id)).toEqual([near.id]);
    expect(v.foods).toHaveLength(1);
  });

  it('ranks the biggest first', () => {
    const a = quiet();
    a.spawn('S', 0, [0, 0], 40);
    a.spawn('B', 0, [500, 0], 400);
    expect(a.ranking().map((s) => s.name)).toEqual(['B', 'S']);
  });

  it('wraps angles into [-π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI);
  });
});

describe('Snake frame codec', () => {
  it('round-trips a frame (ArrayBuffer and Node Buffer)', () => {
    const a = new Arena({ rng: mulberry(5) });
    const s = a.spawn('A', 3, [100, -50]);
    s.angle = 4; // outside [-π, π] on purpose
    const view = a.viewAt(100, -50, 1600, 900);
    const buf = encodeSnakeFrame({
      tick: 42,
      myId: s.id,
      myMass: 33.7,
      camX: 100,
      camY: -50,
      ...view,
    });
    for (const data of [buf, Buffer.from(buf)]) {
      const d = decodeSnakeFrame(data);
      expect(d).toMatchObject({
        tick: 42,
        myId: s.id,
        myMass: 33,
        camX: 100,
        camY: -50,
      });
      const ds = d.snakes.get(s.id)!;
      expect(ds.total).toBe(s.pts.length);
      expect(ds.angle).toBeCloseTo(wrapAngle(4), 3);
      expect(Math.abs(ds.pts.get(0)![0] - s.head[0])).toBeLessThanOrEqual(0.5);
      expect(d.foods.size).toBe(view.foods.length);
    }
  });

  it('maps food color bytes to the palette or the skin', () => {
    expect(snakeFoodColor(1)).toMatch(/^#/);
    const c = snakeSkinFoodColor(9);
    expect(snakeFoodColor(c, 3)).toBe(SNAKE_SKINS[9][3]);
    // the last skin still fits in the byte
    expect(snakeSkinFoodColor(SNAKE_SKINS.length - 1)).toBeLessThan(256);
    expect(SNAKE_SKIN_NAMES).toHaveLength(SNAKE_SKINS.length);
    expect(SNAKE_SKIN_NAMES).toContain('Flamengo');
  });
});

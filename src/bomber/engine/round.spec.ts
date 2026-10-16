import {
  BOMBER_COLS,
  BOMBER_FUSE,
  BOMBER_ROUND_TIME,
  BOMBER_SPAWNS,
  BOMBER_SUDDEN_DEATH_AT,
  BOMBER_TICK_RATE,
  BOMBER_TILE,
  type BomberFrameEvent,
} from '../../contracts';
import {
  BomberRound,
  generateMap,
  spiralOrder,
  tileIndex,
  type RoundBomb,
  type RoundInput,
} from './round';

/** Deterministic PRNG (mulberry32). */
function seeded(seed = 1) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const humans = (n: number) =>
  Array.from({ length: n }, (_, seat) => ({ seat, bot: false }));

/** A round already in play with every soft block removed. */
function open(n = 2): BomberRound {
  const r = new BomberRound(1, humans(n), seeded());
  for (let i = 0; i < r.grid.length; i++)
    if (r.grid[i] === BOMBER_TILE.SOFT) r.grid[i] = BOMBER_TILE.FLOOR;
  r.phase = 'play';
  return r;
}

function run(
  r: BomberRound,
  ticks: number,
  inputs: Record<number, Partial<RoundInput>> = {},
): BomberFrameEvent[] {
  const events: BomberFrameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    for (const [seat, inp] of Object.entries(inputs))
      r.pushInput(Number(seat), {
        d: 0,
        b: false,
        a: false,
        s: r.tickN,
        ...inp,
      });
    r.tick();
    events.push(...r.frame().events);
  }
  return events;
}

const bomb = (over: Partial<RoundBomb>): RoundBomb => ({
  id: 99,
  owner: 1,
  x: 3,
  y: 1,
  fire: 1,
  fuse: 99,
  remote: false,
  slide: 0,
  fly: null,
  held: null,
  ...over,
});

const FUSE_TICKS = Math.ceil(BOMBER_FUSE * BOMBER_TICK_RATE) + 2;

describe('generateMap', () => {
  it('keeps spawns clear and the border hard', () => {
    const grid = generateMap(8, seeded(3));
    for (const [x, y] of BOMBER_SPAWNS)
      expect(grid[tileIndex(x, y)]).toBe(BOMBER_TILE.FLOOR);
    for (let x = 0; x < BOMBER_COLS; x++)
      expect(grid[x]).toBe(BOMBER_TILE.HARD);
    expect(grid.filter((c) => c === BOMBER_TILE.SOFT).length).toBeGreaterThan(
      40,
    );
  });

  it('spiral covers the interior once', () => {
    const tiles = spiralOrder();
    expect(new Set(tiles.map(([x, y]) => tileIndex(x, y))).size).toBe(
      tiles.length,
    );
    expect(tiles[0]).toEqual([1, 1]);
  });
});

describe('BomberRound', () => {
  it('counts down before play and ignores inputs meanwhile', () => {
    const r = new BomberRound(1, humans(2), seeded());
    r.pushInput(0, { d: 4, b: true, a: false, s: 1 });
    const events = run(r, 80);
    expect(events).toContainEqual({ k: 'go' });
    expect(r.phase).toBe('play');
    expect(r.players[0].x).toBe(1);
  });

  it('places a bomb that explodes, kills the owner and chains other bombs', () => {
    const r = open();
    run(r, 1, { 0: { b: true } });
    expect(r.bombs).toHaveLength(1);
    r.bombs.push(bomb({}));
    const events = run(r, FUSE_TICKS);
    expect(r.bombs).toHaveLength(0);
    expect(r.players[0].alive).toBe(false);
    expect(events.filter((e) => e.k === 'boom')).toHaveLength(2);
    expect(events).toContainEqual({ k: 'die', seat: 0, cause: 'fire' });
  });

  it('lets the owner walk off a bomb but never back onto it', () => {
    const r = open();
    const p = r.players[0];
    run(r, 1, { 0: { b: true } });
    run(r, 15, { 0: { d: 4 } });
    expect(p.x).toBeGreaterThanOrEqual(2);
    run(r, 15, { 0: { d: 3 } });
    expect(p.x).toBeCloseTo(2);
    run(r, 12, { 0: { d: 4 } });
    run(r, 20, { 0: { d: 2 } });
    run(r, 90);
    expect(p.alive).toBe(true);
  });

  it('only allows as many bombs as the player has', () => {
    const r = open();
    run(r, 1, { 0: { b: true } });
    run(r, 1, { 0: { d: 4 } });
    run(r, 12, { 0: { d: 4 } });
    run(r, 1, { 0: { b: true } });
    expect(r.bombs).toHaveLength(1);
  });

  it('collects every power-up', () => {
    const r = open();
    const p = r.players[0];
    const row = 'BFSKGMR';
    [...row].forEach((c, i) => (r.grid[tileIndex(1 + i, 1)] = c));
    run(r, 60, { 0: { d: 4 } });
    expect(p.bombs).toBe(2);
    expect(p.fire).toBe(9);
    expect(p.speedUps).toBe(1);
    expect(p.kick && p.glove && p.remote).toBe(true);
    expect(p.collected).toHaveLength(7);
  });

  it('skull curses the player and the curse spreads by touch, then wears off', () => {
    const r = open();
    const [a, b] = r.players;
    r.grid[tileIndex(2, 1)] = 'X';
    const events = run(r, 10, { 0: { d: 4 } });
    expect(events.some((e) => e.k === 'item' && e.c === 'X')).toBe(true);
    expect(a.curse).not.toBeNull();
    b.x = a.x;
    b.y = a.y;
    run(r, 1);
    expect(b.curse).toBe(a.curse);
    b.x = 9;
    a.curseT = 0.01;
    run(r, 2);
    expect(a.curse).toBeNull();
  });

  it.each([
    ['slow', 1.7],
    ['fast', 8.5],
  ] as const)('%s curse changes the speed', (curse, speed) => {
    const r = open();
    r.players[0].curse = curse;
    expect(r.speedOf(r.players[0])).toBe(speed);
  });

  it('reverse curse flips directions and lowfire shrinks the blast', () => {
    const r = open();
    const p = r.players[0];
    p.curse = 'reverse';
    p.curseT = 99;
    run(r, 10, { 0: { d: 3 } });
    expect(p.x).toBeGreaterThan(1);
    p.curse = 'lowfire';
    run(r, 1, { 0: { b: true } });
    expect(r.bombs[0].fire).toBe(1);
  });

  it('nobomb blocks bombs and diarrhea drops them on its own', () => {
    const r = open();
    const p = r.players[0];
    p.curse = 'nobomb';
    p.curseT = 99;
    run(r, 1, { 0: { b: true } });
    expect(r.bombs).toHaveLength(0);
    p.curse = 'diarrhea';
    run(r, 1, { 0: {} });
    expect(r.bombs).toHaveLength(1);
  });

  it('kick sends a bomb sliding until it hits something', () => {
    const r = open();
    r.players[0].kick = true;
    r.bombs.push(bomb({ x: 3 }));
    const events = run(r, 20, { 0: { d: 4 } });
    expect(events).toContainEqual({ k: 'kick' });
    run(r, 40);
    const b = r.bombs[0];
    expect(b.x).toBeGreaterThan(3);
    expect(b.slide).toBe(0);
    expect(b.x).toBe(Math.round(b.x));
  });

  it('glove picks a bomb up, pauses its fuse and throws it over walls', () => {
    const r = open();
    const p = r.players[0];
    p.glove = true;
    run(r, 1, { 0: { b: true } });
    run(r, 1);
    run(r, 1, { 0: { d: 2, a: true } });
    expect(p.holding).not.toBeNull();
    const fuse = r.bombs[0].fuse;
    run(r, 10, { 0: {} });
    expect(r.bombs[0].fuse).toBe(fuse);
    const events = run(r, 1, { 0: { a: true } });
    expect(events).toContainEqual({ k: 'throw' });
    expect(r.frame().bombs[0][4]).not.toBe(0);
    const later = run(r, 30);
    expect(later.some((e) => e.k === 'land')).toBe(true);
    expect([r.bombs[0].x, r.bombs[0].y]).not.toEqual([1, 1]);
  });

  it('a thrown bomb wraps around the arena and bounces off blocked tiles', () => {
    const r = open();
    r.grid[tileIndex(13, 3)] = BOMBER_TILE.SOFT;
    const b = bomb({
      x: 11,
      y: 3,
      fly: { fx: 11, fy: 3, tx: 13, ty: 3, dx: 1, dy: 0, t: 0, dur: 0.1 },
    });
    r.bombs.push(b);
    const events = run(r, 12);
    expect(events).toContainEqual({ k: 'bounce' });
    expect(b.x).toBe(1);
    expect(b.fly).toBeNull();
  });

  it('remote bombs wait for the action button', () => {
    const r = open();
    const p = r.players[0];
    p.remote = true;
    run(r, 1, { 0: { b: true } });
    run(r, 20, { 0: { d: 4 } });
    run(r, 20, { 0: { d: 2 } });
    run(r, 120);
    expect(r.bombs).toHaveLength(1);
    run(r, 1, { 0: { a: true } });
    expect(r.bombs).toHaveLength(0);
    expect(p.alive).toBe(true);
  });

  it('burns soft blocks into floor or items and burns items in the way', () => {
    const r = open();
    r.grid[tileIndex(3, 1)] = BOMBER_TILE.SOFT;
    r.grid[tileIndex(1, 3)] = 'B';
    r.players[0].x = 1;
    r.players[0].y = 2;
    r.bombs.push(bomb({ x: 1, y: 1, fire: 3, fuse: 0.01 }));
    const events = run(r, 1);
    expect(r.grid[tileIndex(3, 1)]).toBe(BOMBER_TILE.BURNING);
    expect(events).toContainEqual({ k: 'burnItem', x: 1, y: 3 });
    run(r, 20);
    expect(r.grid[tileIndex(3, 1)]).not.toBe(BOMBER_TILE.BURNING);
  });

  it('merges crossing flames', () => {
    const r = open(1);
    r.players[0].x = 13;
    r.players[0].y = 11;
    r.bombs.push(bomb({ id: 1, x: 3, y: 3, fire: 2, fuse: 0.01 }));
    r.bombs.push(bomb({ id: 2, x: 5, y: 5, fire: 2, fuse: 0.01 }));
    r.bombs.push(bomb({ id: 3, x: 1, y: 5, fire: 2, fuse: 0.01 }));
    run(r, 1);
    const kinds = new Map(r.frame().flames.map(([k, kind]) => [k, kind]));
    expect(kinds.get(tileIndex(3, 5))).toBe('c');
    expect(kinds.get(tileIndex(4, 5))).toBe('h');
  });

  it('a dead player drops the held bomb and scatters power-ups', () => {
    const r = open(3);
    const p = r.players[0];
    p.collected = ['B', 'F', 'S'];
    p.remote = true;
    r.bombs.push(bomb({ id: 5, owner: 0, remote: true, x: 5, y: 5 }));
    r.bombs.push(bomb({ id: 6, owner: 0, held: 0 }));
    p.holding = 6;
    r.kill(p, 'fire');
    expect(r.grid.filter((c) => 'BFS'.includes(c))).toHaveLength(3);
    expect(r.bombs.find((b) => b.id === 6)!.held).toBeNull();
    expect(r.bombs.find((b) => b.id === 5)!.remote).toBe(false);
  });

  it('remove() takes a leaving player out of the round', () => {
    const r = open(3);
    r.remove(1);
    expect(r.players[1].alive).toBe(false);
    expect(r.frame().events).toContainEqual({
      k: 'die',
      seat: 1,
      cause: 'left',
    });
  });

  it('ends with the last survivor after a short grace', () => {
    const r = open();
    r.players[1].alive = false;
    run(r, 60);
    expect(r.phase).toBe('over');
    expect(r.result).toEqual({ winner: 0 });
    r.tick();
    expect(r.phase).toBe('over');
  });

  it('sudden death drops blocks that crush players and swallow bombs', () => {
    const r = open(2);
    r.time = BOMBER_SUDDEN_DEATH_AT + 0.01;
    r.bombs.push(bomb({ x: 2, y: 1, fuse: 999 }));
    const events = run(r, 40);
    expect(events).toContainEqual({ k: 'hurry' });
    expect(events.some((e) => e.k === 'drop')).toBe(true);
    expect(events).toContainEqual({ k: 'die', seat: 0, cause: 'crush' });
    expect(r.grid[tileIndex(1, 1)]).toBe(BOMBER_TILE.HARD);
    expect(r.bombs.find((b) => b.id === 99)).toBeUndefined();
  });

  it('a timeout with several survivors is a draw', () => {
    const r = open();
    r.time = 0.01;
    r.spiral = [];
    run(r, 3);
    expect(r.result).toEqual({ winner: null });
  });

  it('caps the input queue and catches up when the client is ahead', () => {
    const r = open();
    for (let s = 1; s <= 12; s++)
      r.pushInput(0, { d: 4, b: false, a: false, s });
    expect(r.players[0].queue).toHaveLength(8);
    r.tick();
    expect(r.players[0].lastSeq).toBe(6);
    r.pushInput(5, { d: 1, b: false, a: false });
    r.players[1].alive = false;
    r.pushInput(1, { d: 1, b: false, a: false });
    expect(r.players[1].queue).toHaveLength(0);
  });

  it('serializes a compact frame', () => {
    const r = new BomberRound(4, humans(2), seeded());
    const f = r.frame();
    expect(f.roundNumber).toBe(4);
    expect(f.grid).toHaveLength(BOMBER_COLS * 13);
    expect(f.players[0].slice(0, 3)).toEqual([0, 1, 1]);
    expect(f.timeLeft).toBe(BOMBER_ROUND_TIME);
  });

  it('bots play a full 8-player round to the end', () => {
    const r = new BomberRound(
      1,
      Array.from({ length: 8 }, (_, seat) => ({ seat, bot: true })),
      seeded(7),
    );
    let ticks = 0;
    while (
      r.phase !== 'over' &&
      ticks < BOMBER_TICK_RATE * (BOMBER_ROUND_TIME + 10)
    ) {
      r.tick();
      r.frame();
      ticks++;
    }
    expect(r.phase).toBe('over');
    expect(r.players.filter((p) => !p.alive).length).toBeGreaterThanOrEqual(7);
  });
});

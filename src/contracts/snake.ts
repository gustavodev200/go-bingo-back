import { z } from 'zod';
import { roomCodeSchema } from './room';

// ---------------------------------------------------------------------------
// Arena and rules
// ---------------------------------------------------------------------------

/** Simulation and frame rate (Hz). */
export const SNAKE_TICK_RATE = 20;
export const SNAKE_TICK_MS = 1000 / SNAKE_TICK_RATE;

/** Players per room (online only, no CPUs). */
export const SNAKE_MAX_PLAYERS = 20;
/** Connected players needed in the room before anyone can spawn. */
export const SNAKE_MIN_PLAYERS = 2;

export const SNAKE_ARENA_RADIUS = 2000;
export const SNAKE_START_MASS = 30;
export const SNAKE_MIN_BOOST_MASS = 15;
export const SNAKE_BASE_SPEED = 170; // units/s
export const SNAKE_BOOST_SPEED = 360;
export const SNAKE_BOOST_MASS_PER_SEC = 7;
export const SNAKE_TURN_SPEED = 4.2; // rad/s for a small snake

export const SNAKE_FOOD_TARGET = 900; // ambient pellets kept on the map
export const SNAKE_FOOD_MAX = 2600; // hard cap including remains
export const SNAKE_REMAINS_TTL_MS = 60_000;
/** Extra pull radius around the head. */
export const SNAKE_MAGNET = 34;

/** Mass -> thickness. */
export const snakeRadiusFor = (mass: number) => 10 + Math.sqrt(mass) * 0.42;
/** Mass -> body length in points. */
export const snakePointsFor = (mass: number) =>
  Math.max(8, Math.floor(6 + mass / 3.2));
export const snakeSpacingFor = (radius: number) => radius * 0.55;
/** Bigger snakes turn slower. */
export const snakeTurnFor = (radius: number) =>
  SNAKE_TURN_SPEED * Math.min(1, 16 / radius) ** 0.6;
/** Camera: a bigger snake sees more of the world (1 = closest). */
export const snakeViewScaleFor = (radius: number) =>
  Math.max(0.45, Math.min(1, 1.25 - radius / 60));

/** Neon skins: stripe colors. The index travels on the wire. */
export const SNAKE_SKINS: readonly (readonly string[])[] = [
  ['#3cf27a', '#1fbf55'],
  ['#ff4f6d', '#ffd23f'],
  ['#38b6ff', '#ffffff'],
  ['#ff9f1c', '#ff5400'],
  ['#c77dff', '#7b2cbf'],
  ['#f9f871', '#2ec4b6'],
  ['#ff70a6', '#ff9770', '#ffd670'],
  ['#00f5d4', '#00bbf9', '#9b5de5'],
  ['#e63946', '#f1faee', '#457b9d'],
  ['#ffbe0b', '#fb5607', '#ff006e', '#8338ec', '#3a86ff'],
  ['#222831', '#00fff5'],
  ['#ffffff', '#ff3c3c'],
];

export const SNAKE_FOOD_COLORS = [
  '#ff4f6d',
  '#ffd23f',
  '#3cf27a',
  '#38b6ff',
  '#c77dff',
  '#ff9f1c',
  '#00f5d4',
  '#ff70a6',
];

/**
 * Food color byte: below 128 it is an ambient palette index; from 128 on it
 * is `128 + skin * 10 + stripe`, so remains glow in the dead snake's colors.
 */
export const snakeSkinFoodColor = (skin: number, n: number) =>
  128 + skin * 10 + (n % (SNAKE_SKINS[skin]?.length ?? 1));

export function snakeFoodColor(c: number): string {
  if (c < 128) return SNAKE_FOOD_COLORS[c % SNAKE_FOOD_COLORS.length];
  const skin = SNAKE_SKINS[Math.floor((c - 128) / 10)] ?? SNAKE_SKINS[0];
  return skin[((c - 128) % 10) % skin.length];
}

// ---------------------------------------------------------------------------
// Binary frame: what one player sees this tick. Coordinates are Int16 in half units.
// ---------------------------------------------------------------------------

const FRAME_TYPE = 1;
const Q = 2;
// type, tick, myId, myMass, camX, camY, snake count, food count
const HEADER = 1 + 4 + 2 + 2 + 2 + 2 + 2 + 2;
const SNAKE_HEADER = 2 + 2 + 1 + 2 + 2 + 2; // id, radius*10, flags, angle, total, n
const POINT = 2 + 2 + 2; // idx, x, y
const FOOD = 4 + 2 + 2 + 1 + 1; // id, x, y, value*10, color

export interface SnakeFrameSnakeIn {
  id: number;
  radius: number;
  boost: boolean;
  angle: number;
  /** Body length in points (the frame only carries the visible ones). */
  total: number;
  /** Indexes of the visible points (0 = head). */
  idx: number[];
  /** x, y pairs of those points. */
  xy: number[];
}

export interface SnakeFrameFoodIn {
  id: number;
  x: number;
  y: number;
  v: number;
  c: number;
}

export interface SnakeFrameIn {
  tick: number;
  /** 0 when the viewer has no live snake. */
  myId: number;
  myMass: number;
  camX: number;
  camY: number;
  snakes: SnakeFrameSnakeIn[];
  foods: SnakeFrameFoodIn[];
}

export interface SnakeFrameSnake {
  id: number;
  radius: number;
  boost: boolean;
  angle: number;
  total: number;
  /** idx -> [x, y], in increasing idx order. */
  pts: Map<number, [number, number]>;
}

export interface SnakeFrame {
  tick: number;
  myId: number;
  myMass: number;
  camX: number;
  camY: number;
  snakes: Map<number, SnakeFrameSnake>;
  foods: Map<number, SnakeFrameFoodIn>;
}

const q = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * Q)));
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function encodeSnakeFrame(f: SnakeFrameIn): ArrayBuffer {
  let size = HEADER;
  for (const s of f.snakes) size += SNAKE_HEADER + s.idx.length * POINT;
  size += f.foods.length * FOOD;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint8(o, FRAME_TYPE);
  o += 1;
  dv.setUint32(o, f.tick >>> 0, true);
  o += 4;
  dv.setUint16(o, f.myId, true);
  o += 2;
  dv.setUint16(o, Math.max(0, Math.min(65535, Math.floor(f.myMass))), true);
  o += 2;
  dv.setInt16(o, q(f.camX), true);
  o += 2;
  dv.setInt16(o, q(f.camY), true);
  o += 2;
  dv.setUint16(o, f.snakes.length, true);
  o += 2;
  for (const s of f.snakes) {
    dv.setUint16(o, s.id, true);
    o += 2;
    dv.setUint16(o, Math.min(65535, Math.round(s.radius * 10)), true);
    o += 2;
    dv.setUint8(o, s.boost ? 1 : 0);
    o += 1;
    dv.setInt16(o, Math.round(wrapPi(s.angle) * 10000), true);
    o += 2;
    dv.setUint16(o, s.total, true);
    o += 2;
    dv.setUint16(o, s.idx.length, true);
    o += 2;
    for (let i = 0; i < s.idx.length; i++) {
      dv.setUint16(o, s.idx[i], true);
      dv.setInt16(o + 2, q(s.xy[i * 2]), true);
      dv.setInt16(o + 4, q(s.xy[i * 2 + 1]), true);
      o += POINT;
    }
  }
  dv.setUint16(o, f.foods.length, true);
  o += 2;
  for (const p of f.foods) {
    dv.setUint32(o, p.id >>> 0, true);
    dv.setInt16(o + 4, q(p.x), true);
    dv.setInt16(o + 6, q(p.y), true);
    dv.setUint8(o + 8, Math.min(255, Math.round(p.v * 10)));
    dv.setUint8(o + 9, p.c);
    o += FOOD;
  }
  return buf;
}

/** Accepts what Socket.IO delivers: an ArrayBuffer in browsers, a Buffer in Node. */
export function decodeSnakeFrame(
  data: ArrayBuffer | ArrayBufferView,
): SnakeFrame {
  const dv =
    data instanceof ArrayBuffer
      ? new DataView(data)
      : new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 1;
  const tick = dv.getUint32(o, true);
  o += 4;
  const myId = dv.getUint16(o, true);
  o += 2;
  const myMass = dv.getUint16(o, true);
  o += 2;
  const camX = dv.getInt16(o, true) / Q;
  o += 2;
  const camY = dv.getInt16(o, true) / Q;
  o += 2;
  const ns = dv.getUint16(o, true);
  o += 2;
  const snakes = new Map<number, SnakeFrameSnake>();
  for (let k = 0; k < ns; k++) {
    const id = dv.getUint16(o, true);
    const radius = dv.getUint16(o + 2, true) / 10;
    const boost = dv.getUint8(o + 4) === 1;
    const angle = dv.getInt16(o + 5, true) / 10000;
    const total = dv.getUint16(o + 7, true);
    const n = dv.getUint16(o + 9, true);
    o += SNAKE_HEADER;
    const pts = new Map<number, [number, number]>();
    for (let i = 0; i < n; i++) {
      pts.set(dv.getUint16(o, true), [
        dv.getInt16(o + 2, true) / Q,
        dv.getInt16(o + 4, true) / Q,
      ]);
      o += POINT;
    }
    snakes.set(id, { id, radius, boost, angle, total, pts });
  }
  const nf = dv.getUint16(o, true);
  o += 2;
  const foods = new Map<number, SnakeFrameFoodIn>();
  for (let k = 0; k < nf; k++) {
    const id = dv.getUint32(o, true);
    foods.set(id, {
      id,
      x: dv.getInt16(o + 4, true) / Q,
      y: dv.getInt16(o + 6, true) / Q,
      v: dv.getUint8(o + 8) / 10,
      c: dv.getUint8(o + 9),
    });
    o += FOOD;
  }
  return { tick, myId, myMass, camX, camY, snakes, foods };
}

// ---------------------------------------------------------------------------
// Socket.IO events (namespace /snake)
// ---------------------------------------------------------------------------

export const SNAKE_NAMESPACE = '/snake';
export const SNAKE_PUBLIC_ROOMS_CHANNEL = 'snake-public-rooms';

export const SnakeClientEvents = {
  CREATE: 'snake:create',
  WATCH_ROOMS: 'snake:watch_rooms',
  UNWATCH_ROOMS: 'snake:unwatch_rooms',
  /** Enter a room (also the reconnection); the arena streams right away. */
  JOIN: 'snake:join',
  SET_VISIBILITY: 'snake:set_visibility',
  /** Spawn a snake (again) in the room's arena. */
  PLAY: 'snake:play',
  LEAVE: 'snake:leave',
  /** Fire-and-forget: heading and boost. */
  INPUT: 'snake:input',
  /** Fire-and-forget: world units visible on the screen. */
  VIEW: 'snake:view',
} as const;

export const SnakeServerEvents = {
  STATE: 'snake:state',
  ROOMS_UPDATED: 'snake:rooms_updated',
  /** Binary frame (see encodeSnakeFrame), volatile. */
  FRAME: 'snake:frame',
  /** Names and skins of snakes that appeared. */
  META: 'snake:meta',
  LEADERBOARD: 'snake:leaderboard',
  FEED: 'snake:feed',
  DEAD: 'snake:dead',
} as const;

export const snakeEmptySchema = z.object({}).strict();
export const snakeCreateSchema = z
  .object({ isPublic: z.boolean().default(true) })
  .strict();
export const snakeJoinSchema = z.object({ code: roomCodeSchema });
export const snakeVisibilitySchema = z.object({ isPublic: z.boolean() });
export const snakePlaySchema = z.object({
  skin: z
    .number()
    .int()
    .min(0)
    .max(SNAKE_SKINS.length - 1),
});
export const snakeInputSchema = z.object({
  /** Absolute heading in radians. */
  a: z.number().finite().min(-10).max(10),
  b: z.boolean(),
});
export type SnakeInput = z.infer<typeof snakeInputSchema>;
export const snakeViewSchema = z.object({
  w: z.number().finite().min(1).max(100_000),
  h: z.number().finite().min(1).max(100_000),
});

/** [id, name, skin] */
export type SnakeMeta = [number, string, number];

export interface SnakeRoomPlayer {
  userId: string;
  nickname: string;
  character: string | null;
  connected: boolean;
  /** Has a live snake right now. */
  playing: boolean;
}

export interface SnakeRoomState {
  code: string;
  isPublic: boolean;
  hostId: string;
  players: SnakeRoomPlayer[];
  /** Grows on every change; older states never replace newer ones. */
  version: number;
}

export interface SnakeSnapshot {
  state: SnakeRoomState;
  radius: number;
  meta: SnakeMeta[];
}

export interface SnakePublicRoom {
  code: string;
  hostNickname: string;
  hostCharacter: string | null;
  players: number;
}

export interface SnakeLeaderboardEntry {
  id: number;
  name: string;
  score: number;
}

export interface SnakeServerEventPayloads {
  'snake:state': SnakeRoomState;
  'snake:rooms_updated': { rooms: SnakePublicRoom[] };
  'snake:frame': ArrayBuffer;
  'snake:meta': { meta: SnakeMeta[] };
  'snake:leaderboard': {
    top: SnakeLeaderboardEntry[];
    /** Heads of the top snakes, for the minimap. */
    dots: [number, number][];
    total: number;
    /** 0 when not playing. */
    rank: number;
    me: { score: number; kills: number; x: number; y: number } | null;
  };
  'snake:feed': {
    killer: string | null;
    victim: string;
    killerId: number;
    victimId: number;
  };
  'snake:dead': {
    killer: string | null;
    score: number;
    kills: number;
    rank: number;
    secs: number;
  };
}
export type SnakeServerEventName = keyof SnakeServerEventPayloads;

export interface SnakeClientAckData {
  'snake:create': SnakeSnapshot;
  'snake:watch_rooms': SnakePublicRoom[];
  'snake:unwatch_rooms': null;
  'snake:join': SnakeSnapshot;
  'snake:set_visibility': null;
  'snake:play': { id: number };
  'snake:leave': null;
}

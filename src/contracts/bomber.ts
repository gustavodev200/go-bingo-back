import { z } from 'zod';
import { roomCodeSchema } from './room';

// ---------------------------------------------------------------------------
// Arena and rules
// ---------------------------------------------------------------------------

export const BOMBER_COLS = 15;
export const BOMBER_ROWS = 13;
export const BOMBER_SEATS = 8;
export const BOMBER_MIN_PLAYERS = 2;
/** Simulation and frame rate (Hz). */
export const BOMBER_TICK_RATE = 30;
export const BOMBER_DT = 1 / BOMBER_TICK_RATE;
export const BOMBER_TICK_MS = 1000 / BOMBER_TICK_RATE;

export const BOMBER_BASE_SPEED = 3.4; // tiles/s
export const BOMBER_SPEED_STEP = 0.55;
export const BOMBER_MAX_SPEED_UPS = 5;
export const BOMBER_MAX_BOMBS = 8;
export const BOMBER_MAX_FIRE = 9;
export const BOMBER_FUSE = 2.6; // s
export const BOMBER_FLAME_TIME = 0.55;
export const BOMBER_BURN_TIME = 0.5;
export const BOMBER_KICK_SPEED = 9;
export const BOMBER_THROW_TIME = 0.55;
export const BOMBER_THROW_DIST = 3;
export const BOMBER_CURSE_TIME = 12;
export const BOMBER_ROUND_TIME = 150; // s
/** Seconds left when blocks start falling (sudden death). */
export const BOMBER_SUDDEN_DEATH_AT = 50;
export const BOMBER_DROP_FALL_TIME = 0.35;
export const BOMBER_COUNTDOWN = 2.5;

/** Grid tiles; items use the letters of BOMBER_ITEMS. */
export const BOMBER_TILE = {
  FLOOR: '.',
  HARD: '#',
  SOFT: '%',
  BURNING: '*',
} as const;

export const BOMBER_ITEMS = {
  BOMB: 'B',
  FIRE: 'F',
  SPEED: 'S',
  KICK: 'K',
  GLOVE: 'G',
  SKULL: 'X',
  MAXFIRE: 'M',
  REMOTE: 'R',
} as const;
export type BomberItem = (typeof BOMBER_ITEMS)[keyof typeof BOMBER_ITEMS];
const ITEM_CHARS: string = Object.values(BOMBER_ITEMS).join('');
export const isBomberItem = (c: string | undefined): c is BomberItem =>
  !!c && c.length === 1 && ITEM_CHARS.includes(c);

export const BOMBER_ITEM_NAMES: Record<BomberItem, string> = {
  B: 'Bomba +1',
  F: 'Fogo +1',
  S: 'Patins',
  K: 'Chute',
  G: 'Luva',
  X: 'Caveira',
  M: 'Fogo máximo',
  R: 'Controle remoto',
};

export const BOMBER_CURSES = [
  'slow',
  'fast',
  'lowfire',
  'nobomb',
  'diarrhea',
  'reverse',
] as const;
export type BomberCurse = (typeof BOMBER_CURSES)[number];
export const BOMBER_CURSE_LABEL: Record<BomberCurse, string> = {
  slow: 'Lento!',
  fast: 'Hiper velocidade!',
  lowfire: 'Fogo fraco!',
  nobomb: 'Sem bombas!',
  diarrhea: 'Bombas descontroladas!',
  reverse: 'Controles invertidos!',
};

/** The 8 classic Bomberman colors; each seat picks one, never shared. */
export const BOMBER_COLORS = [
  {
    id: 'white',
    name: 'Branco',
    helmet: '#f8f8f8',
    shade: '#b8c0d8',
    body: '#f0f0f8',
    card: '#dce8fb',
    outline: '#101018',
  },
  {
    id: 'black',
    name: 'Preto',
    helmet: '#3a3a48',
    shade: '#22222c',
    body: '#44445a',
    card: '#efd8f4',
    outline: '#000000',
  },
  {
    id: 'blue',
    name: 'Azul',
    helmet: '#3870f8',
    shade: '#2048b0',
    body: '#4c84ff',
    card: '#cfe0fb',
    outline: '#0a1030',
  },
  {
    id: 'red',
    name: 'Vermelho',
    helmet: '#f04040',
    shade: '#a82020',
    body: '#ff5858',
    card: '#fbd6d6',
    outline: '#300a0a',
  },
  {
    id: 'yellow',
    name: 'Amarelo',
    helmet: '#e8e040',
    shade: '#a8a020',
    body: '#f8f060',
    card: '#f7f3c8',
    outline: '#302c08',
  },
  {
    id: 'green',
    name: 'Verde',
    helmet: '#40c048',
    shade: '#208028',
    body: '#58d860',
    card: '#d4f2d4',
    outline: '#082c0a',
  },
  {
    id: 'pink',
    name: 'Rosa',
    helmet: '#f878c8',
    shade: '#c04890',
    body: '#ff98d8',
    card: '#fbd8ec',
    outline: '#30081c',
  },
  {
    id: 'aqua',
    name: 'Água',
    helmet: '#48d8e8',
    shade: '#2098a8',
    body: '#78e8f8',
    card: '#cdf3f6',
    outline: '#082a30',
  },
] as const;

/** Spawn tiles, classic corners first. */
export const BOMBER_SPAWNS: readonly (readonly [number, number])[] = [
  [1, 1],
  [BOMBER_COLS - 2, BOMBER_ROWS - 2],
  [BOMBER_COLS - 2, 1],
  [1, BOMBER_ROWS - 2],
  [7, 1],
  [7, BOMBER_ROWS - 2],
  [1, 5],
  [BOMBER_COLS - 2, 7],
];

export const bomberRulesSchema = z
  .object({
    /** Rounds a player must win to take the match. */
    winsToWin: z.number().int().min(1).max(5),
  })
  .strict();
export type BomberRules = z.infer<typeof bomberRulesSchema>;
export const DEFAULT_BOMBER_RULES: BomberRules = { winsToWin: 3 };

// ---------------------------------------------------------------------------
// Movement (shared: authoritative on the server, prediction on the client)
// ---------------------------------------------------------------------------

/** 0 none, 1 up, 2 down, 3 left, 4 right. */
export type BomberDir = 0 | 1 | 2 | 3 | 4;
export const BOMBER_DIRS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];
export const BOMBER_OPPOSITE: readonly BomberDir[] = [0, 2, 1, 4, 3];

export const isSolidTile = (c: string | undefined) =>
  c === BOMBER_TILE.HARD || c === BOMBER_TILE.SOFT || c === BOMBER_TILE.BURNING;

export interface BomberWorld {
  grid: string | readonly string[];
  bombAt(tx: number, ty: number): unknown;
}
export interface BomberBody {
  x: number;
  y: number;
}

const EPS = 1e-4;

/**
 * A bomb tile is passable only while the player still overlaps it: you can
 * walk off the bomb you just placed, never back onto it.
 */
export function canEnter(
  world: BomberWorld,
  p: BomberBody,
  tx: number,
  ty: number,
): boolean {
  if (tx < 0 || ty < 0 || tx >= BOMBER_COLS || ty >= BOMBER_ROWS) return false;
  if (isSolidTile(world.grid[ty * BOMBER_COLS + tx])) return false;
  if (!world.bombAt(tx, ty)) return true;
  return Math.abs(p.x - tx) < 0.95 && Math.abs(p.y - ty) < 0.95;
}

/**
 * Moves `p` up to `dist` tiles toward `dir` on the grid, sliding around
 * corners like the SNES game. Returns the tile that blocked it, or null.
 */
export function movePlayer(
  world: BomberWorld,
  p: BomberBody,
  dir: number,
  dist: number,
): [number, number] | null {
  if (!dir) return null;
  const [dx, dy] = BOMBER_DIRS[dir];
  const horiz = dx !== 0;
  const d = horiz ? dx : dy;
  let a = horiz ? p.x : p.y;
  let b = horiz ? p.y : p.x;
  const ok = (along: number, lane: number) =>
    horiz ? canEnter(world, p, along, lane) : canEnter(world, p, lane, along);
  const tileOf = (along: number, lane: number): [number, number] =>
    horiz ? [along, lane] : [lane, along];
  const write = () => {
    if (horiz) {
      p.x = a;
      p.y = b;
    } else {
      p.y = a;
      p.x = b;
    }
  };

  const ac = Math.round(a);
  const bc = Math.round(b);
  const off = b - bc;

  // Off-lane: slide toward a lane that is open ahead (corner assist).
  if (Math.abs(off) > EPS) {
    let target: number | null = null;
    for (const lane of [bc, bc + Math.sign(off)]) {
      if (ok(ac + d, lane) && ok(ac, lane)) {
        target = lane;
        break;
      }
    }
    if (target === null && (a - ac) * d < -EPS && ok(ac, bc)) target = bc;
    if (target === null) return tileOf(ac + d, bc);
    const db = target - b;
    const mv = Math.min(dist, Math.abs(db));
    b += Math.sign(db) * mv;
    dist -= mv;
    if (Math.abs(target - b) <= EPS) b = target;
    if (b !== target) {
      write();
      return null;
    }
  }

  // Aligned: move along the lane, stopping at the tile center if blocked ahead.
  const lane = Math.round(b);
  const center = Math.round(a);
  let na = a + d * dist;
  let blocked: [number, number] | null = null;
  if ((na - center) * d > 0 && !ok(center + d, lane)) {
    na = (a - center) * d > 0 ? a : center;
    blocked = tileOf(center + d, lane);
  }
  a = na;
  write();
  return blocked;
}

// ---------------------------------------------------------------------------
// Room state
// ---------------------------------------------------------------------------

export const BOMBER_ROOM_PHASES = ['LOBBY', 'PLAYING', 'FINISHED'] as const;
export type BomberRoomPhase = (typeof BOMBER_ROOM_PHASES)[number];
export type BomberLobbyStatus = 'WAITING_PLAYERS' | 'READY_TO_START';

export interface BomberSeatPlayer {
  seat: number;
  /** Bots get a synthetic id (`cpu:N`). */
  userId: string;
  nickname: string;
  character: string | null;
  /** Index in BOMBER_COLORS. */
  color: number;
  bot: boolean;
  ready: boolean;
  connected: boolean;
  /** Epoch ms when the reserved seat is released; null while connected. */
  reconnectDeadline: number | null;
}

export interface BomberMatchResult {
  winner: number;
  wins: number[];
}

/** Room-level state (lobby, scoreboard). The arena itself travels in frames. */
export interface BomberRoomState {
  code: string;
  version: number;
  hostId: string;
  isPublic: boolean;
  rules: BomberRules;
  phase: BomberRoomPhase;
  lobbyStatus: BomberLobbyStatus | null;
  seats: (BomberSeatPlayer | null)[];
  /** Rounds won by seat. */
  wins: number[];
  roundNumber: number;
  result: BomberMatchResult | null;
}

export interface BomberSnapshot {
  state: BomberRoomState;
  mySeat: number;
  frame: BomberFrame | null;
}

export interface BomberPublicRoom {
  code: string;
  hostNickname: string;
  hostCharacter: string | null;
  players: number;
  rules: BomberRules;
}

export const BOMBER_PUBLIC_ROOMS_CHANNEL = 'bomber-public-rooms';

// ---------------------------------------------------------------------------
// Frames (sent every tick while a round runs)
// ---------------------------------------------------------------------------

export type BomberRoundPhase = 'countdown' | 'play' | 'ending' | 'over';
export type BomberFlameKind = 'c' | 'h' | 'v' | 'u' | 'd' | 'l' | 'r';

/** [seat, x, y, dir, moving, alive, speed, curse|0, lastSeq, holding, bombs, fire, speedUps, flags(1 kick, 2 glove, 4 remote)] */
export type BomberFramePlayer = [
  number,
  number,
  number,
  BomberDir,
  0 | 1,
  0 | 1,
  number,
  BomberCurse | 0,
  number,
  0 | 1,
  number,
  number,
  number,
  number,
];
/** [id, x, y, remote, flight [fromX, fromY, toX, toY, progress] | 0, heldBySeat (-1 none), fuse 1→0] */
export type BomberFrameBomb = [
  number,
  number,
  number,
  0 | 1,
  [number, number, number, number, number] | 0,
  number,
  number,
];
/** [tile index, kind, life 1→0] */
export type BomberFrameFlame = [number, BomberFlameKind, number];
/** [x, y, fall progress 0→1] */
export type BomberFrameDrop = [number, number, number];

export type BomberFrameEvent =
  | { k: 'go' }
  | { k: 'hurry' }
  | { k: 'place' }
  | { k: 'kick' }
  | { k: 'throw' }
  | { k: 'pick' }
  | { k: 'land' }
  | { k: 'bounce' }
  | { k: 'boom'; x: number; y: number }
  | { k: 'burnItem'; x: number; y: number }
  | { k: 'drop'; x: number; y: number }
  | { k: 'thud'; x: number; y: number }
  | { k: 'die'; seat: number; cause: 'fire' | 'crush' | 'left' }
  | { k: 'item'; seat: number; c: BomberItem; curse?: BomberCurse };

export interface BomberFrame {
  roundNumber: number;
  phase: BomberRoundPhase;
  /** Seconds left in the countdown/ending phase. */
  phaseLeft: number;
  timeLeft: number;
  grid: string;
  players: BomberFramePlayer[];
  bombs: BomberFrameBomb[];
  flames: BomberFrameFlame[];
  drops: BomberFrameDrop[];
  events: BomberFrameEvent[];
}

// ---------------------------------------------------------------------------
// Socket.IO events (namespace /bomber)
// ---------------------------------------------------------------------------

export const BOMBER_NAMESPACE = '/bomber';

export const BomberClientEvents = {
  CREATE: 'bomber:create',
  WATCH_ROOMS: 'bomber:watch_rooms',
  UNWATCH_ROOMS: 'bomber:unwatch_rooms',
  SET_VISIBILITY: 'bomber:set_visibility',
  SET_RULES: 'bomber:set_rules',
  JOIN: 'bomber:join',
  SYNC: 'bomber:sync',
  LEAVE: 'bomber:leave',
  READY: 'bomber:ready',
  SET_COLOR: 'bomber:set_color',
  ADD_BOT: 'bomber:add_bot',
  REMOVE_BOT: 'bomber:remove_bot',
  START: 'bomber:start',
  REMATCH: 'bomber:rematch',
  /** Fire-and-forget, one per client tick. */
  INPUT: 'bomber:input',
} as const;

export const BomberServerEvents = {
  STATE: 'bomber:state',
  FRAME: 'bomber:frame',
  ROOMS_UPDATED: 'bomber:rooms_updated',
  ROOM_CLOSED: 'bomber:room_closed',
  PLAYER_JOINED: 'bomber:player_joined',
  PLAYER_LEFT: 'bomber:player_left',
  PLAYER_DISCONNECTED: 'bomber:player_disconnected',
  PLAYER_RECONNECTED: 'bomber:player_reconnected',
  MATCH_STARTED: 'bomber:match_started',
  ROUND_STARTED: 'bomber:round_started',
  ROUND_ENDED: 'bomber:round_ended',
  MATCH_OVER: 'bomber:match_over',
} as const;

export const bomberEmptySchema = z.object({}).strict();
export const bomberCreateSchema = z
  .object({ isPublic: z.boolean().default(true) })
  .strict();
export const bomberVisibilitySchema = z.object({ isPublic: z.boolean() });
export const bomberSetRulesSchema = z.object({ rules: bomberRulesSchema });
export const bomberJoinSchema = z.object({ code: roomCodeSchema });
export const bomberReadySchema = z.object({ ready: z.boolean() });
export const bomberColorSchema = z.object({
  color: z
    .number()
    .int()
    .min(0)
    .max(BOMBER_COLORS.length - 1),
});
export const bomberRemoveBotSchema = z.object({
  seat: z
    .number()
    .int()
    .min(0)
    .max(BOMBER_SEATS - 1),
});
export const bomberInputSchema = z.object({
  /** Client sequence number, echoed back as lastSeq for prediction. */
  s: z.number().int().min(0).max(2_147_483_647),
  d: z.number().int().min(0).max(4),
  /** Bomb button held this tick. */
  b: z.boolean(),
  /** Action button (glove / remote) held this tick. */
  a: z.boolean(),
});
export type BomberInput = z.infer<typeof bomberInputSchema>;

export type BomberLeftReason = 'left' | 'expired' | 'removed';

/** Announcements carry a room-wide sequence number so clients can drop duplicates. */
export interface BomberServerEventPayloads {
  'bomber:state': BomberRoomState;
  'bomber:frame': BomberFrame;
  'bomber:rooms_updated': { rooms: BomberPublicRoom[] };
  'bomber:room_closed': { reason: 'empty' };
  'bomber:player_joined': { seq: number; player: BomberSeatPlayer };
  'bomber:player_left': {
    seq: number;
    seat: number;
    userId: string;
    reason: BomberLeftReason;
  };
  'bomber:player_disconnected': {
    seq: number;
    seat: number;
    reconnectDeadline: number;
  };
  'bomber:player_reconnected': { seq: number; seat: number };
  'bomber:match_started': { seq: number };
  'bomber:round_started': { seq: number; roundNumber: number };
  'bomber:round_ended': {
    seq: number;
    roundNumber: number;
    /** null = draw. */
    winner: number | null;
    wins: number[];
  };
  'bomber:match_over': { seq: number } & BomberMatchResult;
}
export type BomberServerEventName = keyof BomberServerEventPayloads;

export interface BomberClientAckData {
  'bomber:create': BomberSnapshot;
  'bomber:watch_rooms': BomberPublicRoom[];
  'bomber:unwatch_rooms': null;
  'bomber:set_visibility': null;
  'bomber:set_rules': null;
  'bomber:join': BomberSnapshot;
  'bomber:sync': BomberSnapshot;
  'bomber:leave': null;
  'bomber:ready': null;
  'bomber:set_color': null;
  'bomber:add_bot': null;
  'bomber:remove_bot': null;
  'bomber:start': null;
  'bomber:rematch': null;
}

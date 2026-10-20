import { z } from 'zod';
import { roomCodeSchema } from './room';

/**
 * Infiltrado: dedução social na Estação Abissal (base submarina). A tripulação faz tarefas e
 * caça os infiltrados; os infiltrados eliminam, usam dutos e sabotam. Até 15 jogadores.
 *
 * Tudo que o servidor e o front precisam concordar mora aqui: o mapa (salas, paredes, estações,
 * dutos), o movimento com colisão (predição no front), a linha de visão e os eventos.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INF_SEATS = 15;
export const INF_MIN_PLAYERS = 4;
/** Simulation and frame rate (Hz). */
export const INF_TICK_RATE = 20;
export const INF_DT = 1 / INF_TICK_RATE;
export const INF_TICK_MS = 1000 / INF_TICK_RATE;

export const INF_COLS = 64;
export const INF_ROWS = 40;
/** Player collision half-size (tiles). */
export const INF_BODY = 0.3;
export const INF_SPEED = 3.6; // tiles/s
export const INF_GHOST_SPEED = 4.6;

export const INF_VISION_CREW = 5.5;
export const INF_VISION_IMPOSTOR = 7.5;
export const INF_VISION_DARK = 1.8;

/** Reach (tiles, center to center) of each interaction. */
export const INF_USE_RANGE = 1.5;
export const INF_KILL_RANGE = 1.7;
export const INF_REPORT_RANGE = 2.4;

export const INF_INTRO_TIME = 5; // s
export const INF_EJECT_TIME = 6;
export const INF_RESULT_TIME = 4;
/** Emergency button is locked this long after the start and after each meeting. */
export const INF_BUTTON_COOLDOWN = 15;
export const INF_SABOTAGE_COOLDOWN = 30;
export const INF_CRITICAL_TIME = 45;
/** Kill cooldown when the round (re)starts, as in the original. */
export const INF_FIRST_KILL_COOLDOWN = 15;
export const INF_CHAT_MAX = 120;
export const INF_CHAT_HISTORY = 60;

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

/** The divers: each seat picks one color, never shared. */
export const INF_COLORS = [
  { id: 'coral', name: 'Coral', body: '#ff6b5a', shade: '#c23f33' },
  { id: 'azul', name: 'Azul', body: '#3b82f6', shade: '#1d4ed8' },
  { id: 'verde', name: 'Verde', body: '#22c55e', shade: '#15803d' },
  { id: 'rosa', name: 'Rosa', body: '#f472b6', shade: '#be3d85' },
  { id: 'laranja', name: 'Laranja', body: '#fb923c', shade: '#c2620f' },
  { id: 'amarelo', name: 'Amarelo', body: '#facc15', shade: '#b48d08' },
  { id: 'grafite', name: 'Grafite', body: '#52525b', shade: '#2a2a30' },
  { id: 'neve', name: 'Neve', body: '#e2e8f0', shade: '#94a3b8' },
  { id: 'roxo', name: 'Roxo', body: '#a855f7', shade: '#7024b8' },
  { id: 'caramelo', name: 'Caramelo', body: '#a16207', shade: '#6b3f04' },
  { id: 'ciano', name: 'Ciano', body: '#22d3ee', shade: '#0e97ad' },
  { id: 'lima', name: 'Lima', body: '#a3e635', shade: '#6b9a1d' },
  { id: 'vinho', name: 'Vinho', body: '#9f1239', shade: '#62081f' },
  { id: 'menta', name: 'Menta', body: '#5eead4', shade: '#20a593' },
  { id: 'areia', name: 'Areia', body: '#e7c697', shade: '#b0905e' },
] as const;

// ---------------------------------------------------------------------------
// Map: Estação Abissal
// ---------------------------------------------------------------------------

export interface InfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface InfRoom extends InfRect {
  id: string;
  name: string;
}

export const INF_ROOMS: readonly InfRoom[] = [
  { id: 'atrio', name: 'Átrio', x: 24, y: 14, w: 16, h: 10 },
  { id: 'hidro', name: 'Hidroponia', x: 3, y: 3, w: 12, h: 8 },
  { id: 'lab', name: 'Laboratório', x: 26, y: 2, w: 12, h: 8 },
  { id: 'sonar', name: 'Sonar', x: 49, y: 3, w: 12, h: 8 },
  { id: 'o2', name: 'Oxigênio', x: 49, y: 15, w: 11, h: 8 },
  { id: 'doca', name: 'Doca', x: 48, y: 29, w: 13, h: 8 },
  { id: 'eletrica', name: 'Elétrica', x: 26, y: 30, w: 12, h: 7 },
  { id: 'reator', name: 'Reator', x: 3, y: 16, w: 10, h: 9 },
  { id: 'enfermaria', name: 'Enfermaria', x: 3, y: 29, w: 12, h: 8 },
];

/** Corridors (3 tiles wide) that join the rooms. */
export const INF_HALLS: readonly InfRect[] = [
  { x: 15, y: 5, w: 11, h: 3 },
  { x: 38, y: 5, w: 11, h: 3 },
  { x: 31, y: 10, w: 3, h: 4 },
  { x: 53, y: 11, w: 3, h: 4 },
  { x: 40, y: 18, w: 9, h: 3 },
  { x: 13, y: 18, w: 11, h: 3 },
  { x: 7, y: 11, w: 3, h: 5 },
  { x: 7, y: 25, w: 3, h: 4 },
  { x: 15, y: 32, w: 11, h: 3 },
  { x: 31, y: 24, w: 3, h: 6 },
  { x: 38, y: 32, w: 10, h: 3 },
  { x: 53, y: 23, w: 3, h: 6 },
];

function buildGrid(): string {
  const g = Array<string>(INF_COLS * INF_ROWS).fill('#');
  for (const r of [...INF_ROOMS, ...INF_HALLS])
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) g[y * INF_COLS + x] = '.';
  return g.join('');
}
/** One char per tile, row by row: '.' floor, '#' solid. */
export const INF_GRID = buildGrid();

export const isInfFloor = (tx: number, ty: number): boolean =>
  tx >= 0 &&
  ty >= 0 &&
  tx < INF_COLS &&
  ty < INF_ROWS &&
  INF_GRID[ty * INF_COLS + tx] === '.';

/** Room containing a point, or null in the corridors. */
export function infRoomAt(x: number, y: number): InfRoom | null {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return (
    INF_ROOMS.find(
      (r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h,
    ) ?? null
  );
}

export const INF_TASK_TYPES = [
  'wires',
  'dial',
  'keypad',
  'fill',
  'clean',
  'download',
  'align',
  'scan',
] as const;
export type InfTaskType = (typeof INF_TASK_TYPES)[number];

export const INF_TASK_INFO: Record<
  InfTaskType,
  {
    name: string;
    /** Server-side minimum time between opening and finishing (ms). */ minMs: number;
  }
> = {
  wires: { name: 'Religar cabos', minMs: 1500 },
  dial: { name: 'Calibrar sonar', minMs: 1500 },
  keypad: { name: 'Digitar sequência', minMs: 2000 },
  fill: { name: 'Encher tanque', minMs: 2500 },
  clean: { name: 'Limpar filtro', minMs: 1500 },
  download: { name: 'Transferir dados', minMs: 5500 },
  align: { name: 'Alinhar válvula', minMs: 1200 },
  scan: { name: 'Escaneamento médico', minMs: 6500 },
};

export interface InfStation {
  id: number;
  type: InfTaskType;
  room: string;
  /** Tile coordinates of the console (center of the tile). */
  x: number;
  y: number;
}

/** Task consoles. Coordinates are tile centers inside each room. */
export const INF_STATIONS: readonly InfStation[] = [
  { id: 0, type: 'clean', room: 'hidro', x: 4.5, y: 3.5 },
  { id: 1, type: 'fill', room: 'hidro', x: 13.5, y: 9.5 },
  { id: 2, type: 'scan', room: 'lab', x: 29.5, y: 3.5 },
  { id: 3, type: 'keypad', room: 'lab', x: 36.5, y: 2.5 },
  { id: 4, type: 'dial', room: 'sonar', x: 51.5, y: 3.5 },
  { id: 5, type: 'download', room: 'sonar', x: 59.5, y: 8.5 },
  { id: 6, type: 'clean', room: 'o2', x: 58.5, y: 15.5 },
  { id: 7, type: 'fill', room: 'o2', x: 51.5, y: 21.5 },
  { id: 8, type: 'download', room: 'atrio', x: 25.5, y: 14.5 },
  { id: 9, type: 'keypad', room: 'reator', x: 3.5, y: 16.5 },
  { id: 10, type: 'align', room: 'reator', x: 11.5, y: 23.5 },
  { id: 11, type: 'scan', room: 'enfermaria', x: 5.5, y: 35.5 },
  { id: 12, type: 'wires', room: 'enfermaria', x: 13.5, y: 29.5 },
  { id: 13, type: 'wires', room: 'eletrica', x: 27.5, y: 30.5 },
  { id: 14, type: 'align', room: 'eletrica', x: 36.5, y: 35.5 },
  { id: 15, type: 'wires', room: 'doca', x: 59.5, y: 29.5 },
  { id: 16, type: 'dial', room: 'doca', x: 49.5, y: 35.5 },
  { id: 17, type: 'download', room: 'eletrica', x: 31.5, y: 35.5 },
];

export const INF_BUTTON = { x: 32, y: 19 } as const;

export interface InfVent {
  id: number;
  room: string;
  x: number;
  y: number;
  /** Vents reachable from this one. */
  links: number[];
}

export const INF_VENTS: readonly InfVent[] = [
  { id: 0, room: 'hidro', x: 4.5, y: 9.5, links: [1, 2] },
  { id: 1, room: 'reator', x: 9.5, y: 16.5, links: [0, 2] },
  { id: 2, room: 'enfermaria', x: 13.5, y: 33.5, links: [0, 1] },
  { id: 3, room: 'lab', x: 27.5, y: 8.5, links: [4, 5] },
  { id: 4, room: 'atrio', x: 38.5, y: 22.5, links: [3, 5] },
  { id: 5, room: 'eletrica', x: 36.5, y: 30.5, links: [3, 4] },
  { id: 6, room: 'sonar', x: 59.5, y: 4.5, links: [7, 8] },
  { id: 7, room: 'o2', x: 50.5, y: 16.5, links: [6, 8] },
  { id: 8, room: 'doca', x: 59.5, y: 35.5, links: [6, 7] },
];

export const INF_SABOTAGES = ['lights', 'oxygen', 'reactor'] as const;
export type InfSabotage = (typeof INF_SABOTAGES)[number];
export const INF_SABOTAGE_INFO: Record<
  InfSabotage,
  { name: string; critical: boolean }
> = {
  lights: { name: 'Luzes apagadas', critical: false },
  oxygen: { name: 'Oxigênio acabando', critical: true },
  reactor: { name: 'Reator instável', critical: true },
};

/** Repair panels of each sabotage (lights 1 panel, oxygen 2 codes, reactor 2 hands at once). */
export const INF_FIX_PANELS: Record<
  InfSabotage,
  readonly { room: string; x: number; y: number }[]
> = {
  lights: [{ room: 'eletrica', x: 33.5, y: 30.5 }],
  oxygen: [
    { room: 'o2', x: 55.5, y: 15.5 },
    { room: 'hidro', x: 3.5, y: 6.5 },
  ],
  reactor: [
    { room: 'reator', x: 3.5, y: 21.5 },
    { room: 'reator', x: 12.5, y: 18.5 },
  ],
};

export const infDist = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(ax - bx, ay - by);

// ---------------------------------------------------------------------------
// Movement and sight (shared: authoritative on the server, prediction on the client)
// ---------------------------------------------------------------------------

export interface InfBody {
  x: number;
  y: number;
}

function blocked(x: number, y: number): boolean {
  const h = INF_BODY;
  const x0 = Math.floor(x - h);
  const x1 = Math.floor(x + h - 1e-6);
  const y0 = Math.floor(y - h);
  const y1 = Math.floor(y + h - 1e-6);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) if (!isInfFloor(tx, ty)) return true;
  return false;
}

/**
 * Moves `p` by the joystick vector (`jx`, `jy`, length ≤ 1) for `dt` seconds.
 * Axis-separated against the tile walls, so it slides along them. Ghosts fly
 * through walls but stay inside the map.
 */
export function infMove(
  p: InfBody,
  jx: number,
  jy: number,
  dt: number,
  ghost = false,
): void {
  let len = Math.hypot(jx, jy);
  if (len < 0.05) return;
  if (len > 1) {
    jx /= len;
    jy /= len;
    len = 1;
  }
  const speed = ghost ? INF_GHOST_SPEED : INF_SPEED;
  const dx = jx * speed * dt;
  const dy = jy * speed * dt;
  if (ghost) {
    p.x = Math.min(INF_COLS - 0.5, Math.max(0.5, p.x + dx));
    p.y = Math.min(INF_ROWS - 0.5, Math.max(0.5, p.y + dy));
    return;
  }
  // Sub-steps keep fast moves from tunnelling through a wall corner.
  const steps = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.25),
  );
  for (let i = 0; i < steps; i++) {
    const nx = p.x + dx / steps;
    if (!blocked(nx, p.y)) p.x = nx;
    const ny = p.y + dy / steps;
    if (!blocked(p.x, ny)) p.y = ny;
  }
}

/** Whether a straight line between two points crosses no wall tile (grid DDA). */
export function infLineOfSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  let tx = Math.floor(ax);
  let ty = Math.floor(ay);
  const ex = Math.floor(bx);
  const ey = Math.floor(by);
  const dx = bx - ax;
  const dy = by - ay;
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  const tdx = dx === 0 ? Infinity : Math.abs(1 / dx);
  const tdy = dy === 0 ? Infinity : Math.abs(1 / dy);
  let tmx = dx === 0 ? Infinity : (dx > 0 ? tx + 1 - ax : ax - tx) * tdx;
  let tmy = dy === 0 ? Infinity : (dy > 0 ? ty + 1 - ay : ay - ty) * tdy;
  for (let i = 0; i < 256; i++) {
    if (tx === ex && ty === ey) return true;
    if (tmx < tmy) {
      tmx += tdx;
      tx += sx;
    } else {
      tmy += tdy;
      ty += sy;
    }
    if (!isInfFloor(tx, ty)) return false;
  }
  return true;
}

/** Distance to the first wall from (x, y) along angle `a`, up to `max` (client fog). */
export function infRayLength(
  x: number,
  y: number,
  a: number,
  max: number,
): number {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let tx = Math.floor(x);
  let ty = Math.floor(y);
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  const tdx = dx === 0 ? Infinity : Math.abs(1 / dx);
  const tdy = dy === 0 ? Infinity : Math.abs(1 / dy);
  let tmx = dx === 0 ? Infinity : (dx > 0 ? tx + 1 - x : x - tx) * tdx;
  let tmy = dy === 0 ? Infinity : (dy > 0 ? ty + 1 - y : y - ty) * tdy;
  for (;;) {
    let t: number;
    if (tmx < tmy) {
      t = tmx;
      tmx += tdx;
      tx += sx;
    } else {
      t = tmy;
      tmy += tdy;
      ty += sy;
    }
    if (t >= max) return max;
    if (!isInfFloor(tx, ty)) return t;
  }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const infRulesSchema = z
  .object({
    impostors: z.number().int().min(1).max(3),
    /** Seconds between kills. */
    killCooldown: z.number().int().min(10).max(60),
    discussionTime: z.number().int().min(0).max(120),
    votingTime: z.number().int().min(15).max(180),
    /** Tasks each crewmate gets. */
    tasks: z.number().int().min(2).max(8),
    emergencyMeetings: z.number().int().min(1).max(3),
    /** Reveal whether the ejected player was an infiltrator. */
    confirmEjects: z.boolean(),
  })
  .strict();
export type InfRules = z.infer<typeof infRulesSchema>;
export const DEFAULT_INF_RULES: InfRules = {
  impostors: 1,
  killCooldown: 30,
  discussionTime: 30,
  votingTime: 60,
  tasks: 5,
  emergencyMeetings: 1,
  confirmEjects: true,
};

/** Most infiltrators a table of `players` can have (the original's limits). */
export const infMaxImpostors = (players: number) =>
  players < 7 ? 1 : players < 10 ? 2 : 3;

// ---------------------------------------------------------------------------
// Room state (public: never carries roles until the match is over)
// ---------------------------------------------------------------------------

export const INF_ROOM_PHASES = ['LOBBY', 'PLAYING', 'FINISHED'] as const;
export type InfRoomPhase = (typeof INF_ROOM_PHASES)[number];
export type InfLobbyStatus = 'WAITING_PLAYERS' | 'READY_TO_START';

export interface InfSeatPlayer {
  seat: number;
  /** Bots get a synthetic id (`cpu:N`). */
  userId: string;
  nickname: string;
  character: string | null;
  /** Index in INF_COLORS. */
  color: number;
  bot: boolean;
  ready: boolean;
  connected: boolean;
  reconnectDeadline: number | null;
}

export type InfTeam = 'crew' | 'impostor';
export type InfWinReason = 'tasks' | 'votes' | 'kills' | 'sabotage' | 'left';

export interface InfMatchResult {
  winner: InfTeam;
  reason: InfWinReason;
  impostors: number[];
}

export interface InfRoomState {
  code: string;
  version: number;
  hostId: string;
  isPublic: boolean;
  /** Aposta de cada jogador nesta mesa (Arena). */
  stake: number;
  rules: InfRules;
  phase: InfRoomPhase;
  lobbyStatus: InfLobbyStatus | null;
  seats: (InfSeatPlayer | null)[];
  result: InfMatchResult | null;
}

export interface InfSnapshot {
  state: InfRoomState;
  mySeat: number;
  frame: InfFrame | null;
  chat: InfChatMessage[];
}

export interface InfPublicRoom {
  code: string;
  hostNickname: string;
  hostCharacter: string | null;
  stake: number;
  players: number;
  rules: InfRules;
}

export const INF_PUBLIC_ROOMS_CHANNEL = 'infiltrado-public-rooms';

// ---------------------------------------------------------------------------
// Frames (one per viewer: each player only receives what they can see)
// ---------------------------------------------------------------------------

export type InfPhase = 'intro' | 'play' | 'meeting' | 'eject' | 'over';
export type InfRole = InfTeam;

/** [seat, x, y, facing (-1 left, 1 right), moving, flags (1 ghost, 2 fellow infiltrator)] */
export type InfFramePlayer = [number, number, number, -1 | 1, 0 | 1, number];
/** [seat, x, y] */
export type InfFrameBody = [number, number, number];

export interface InfMe {
  x: number;
  y: number;
  alive: boolean;
  role: InfRole;
  /** Fellow infiltrators (only for infiltrators). */
  mates: number[];
  lastSeq: number;
  /** Seconds until the next kill (infiltrators). */
  killCd: number;
  /** Seconds until the next sabotage (infiltrators). */
  sabotageCd: number;
  /** Vent id while hiding inside one, else -1. */
  vent: number;
  meetingsLeft: number;
  /** [station id, done] — infiltrators get a fake list. */
  tasks: [number, 0 | 1][];
  /** Reactor panel I am holding, or -1. */
  holding: number;
}

export interface InfSabotageState {
  kind: InfSabotage;
  /** Seconds left before the station is lost (critical only). */
  left: number | null;
  /** Panels already fixed / being held. */
  fixed: (0 | 1)[];
}

export type InfMeetingStage = 'talk' | 'vote' | 'result';

export interface InfMeeting {
  /** Seat who called it. */
  caller: number;
  /** Reported body, or null for the emergency button. */
  body: number | null;
  stage: InfMeetingStage;
  left: number;
  /** Seats that can vote (alive when the meeting started). */
  voters: number[];
  /** Who has already voted (not whom). */
  voted: number[];
  /** Revealed at the result stage: [voter, target] (-1 = skip). */
  votes: [number, number][] | null;
}

export interface InfEjection {
  /** null = nobody (tie or skip). */
  seat: number | null;
  tie: boolean;
  /** null when the room hides it (confirmEjects off). */
  wasImpostor: boolean | null;
  impostorsLeft: number | null;
}

export type InfFrameEvent =
  | { k: 'killed'; by: number }
  | { k: 'kill' }
  | { k: 'task'; station: number }
  | { k: 'sabotage'; kind: InfSabotage }
  | { k: 'fixed'; kind: InfSabotage }
  | { k: 'vent' };

export interface InfFrame {
  phase: InfPhase;
  /** Seconds left of intro / eject. */
  phaseLeft: number;
  me: InfMe;
  players: InfFramePlayer[];
  bodies: InfFrameBody[];
  /** Crew task progress 0→1. */
  taskBar: number;
  sabotage: InfSabotageState | null;
  /** Emergency button lock (s). */
  buttonCd: number;
  meeting: InfMeeting | null;
  eject: InfEjection | null;
  events: InfFrameEvent[];
}

export interface InfChatMessage {
  id: number;
  seat: number;
  text: string;
  /** Sent by a ghost: only ghosts see it. */
  ghost: boolean;
}

// ---------------------------------------------------------------------------
// Socket.IO events (namespace /infiltrado)
// ---------------------------------------------------------------------------

export const INF_NAMESPACE = '/infiltrado';

export const InfClientEvents = {
  CREATE: 'inf:create',
  WATCH_ROOMS: 'inf:watch_rooms',
  UNWATCH_ROOMS: 'inf:unwatch_rooms',
  SET_VISIBILITY: 'inf:set_visibility',
  /** Host only, lobby only: how much each player bets. */
  SET_STAKE: 'inf:set_stake',
  SET_RULES: 'inf:set_rules',
  JOIN: 'inf:join',
  SYNC: 'inf:sync',
  LEAVE: 'inf:leave',
  READY: 'inf:ready',
  SET_COLOR: 'inf:set_color',
  ADD_BOT: 'inf:add_bot',
  REMOVE_BOT: 'inf:remove_bot',
  START: 'inf:start',
  REMATCH: 'inf:rematch',
  /** In-game actions (use, kill, report, vote...). */
  ACT: 'inf:act',
  CHAT: 'inf:chat',
  /** Fire-and-forget joystick, one per client tick. */
  INPUT: 'inf:input',
} as const;

export const InfServerEvents = {
  STATE: 'inf:state',
  FRAME: 'inf:frame',
  CHAT: 'inf:chat',
  ROOMS_UPDATED: 'inf:rooms_updated',
  PLAYER_JOINED: 'inf:player_joined',
  PLAYER_LEFT: 'inf:player_left',
  PLAYER_DISCONNECTED: 'inf:player_disconnected',
  PLAYER_RECONNECTED: 'inf:player_reconnected',
  MATCH_STARTED: 'inf:match_started',
  MATCH_OVER: 'inf:match_over',
} as const;

export const infEmptySchema = z.object({}).strict();
export const infCreateSchema = z
  .object({ isPublic: z.boolean().default(true) })
  .strict();
export const infVisibilitySchema = z.object({ isPublic: z.boolean() });
export const infSetRulesSchema = z.object({ rules: infRulesSchema });
export const infJoinSchema = z.object({ code: roomCodeSchema });
export const infReadySchema = z.object({ ready: z.boolean() });
export const infColorSchema = z.object({
  color: z
    .number()
    .int()
    .min(0)
    .max(INF_COLORS.length - 1),
});
export const infRemoveBotSchema = z.object({
  seat: z
    .number()
    .int()
    .min(0)
    .max(INF_SEATS - 1),
});
export const infInputSchema = z.object({
  /** Client sequence number, echoed back as lastSeq for prediction. */
  s: z.number().int().min(0).max(2_147_483_647),
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
});
export type InfInput = z.infer<typeof infInputSchema>;

const seatField = z
  .number()
  .int()
  .min(0)
  .max(INF_SEATS - 1);
const stationField = z
  .number()
  .int()
  .min(0)
  .max(INF_STATIONS.length - 1);

export const infActSchema = z.discriminatedUnion('t', [
  /** Opened a task console (starts the anti-cheat clock). */
  z.object({ t: z.literal('task_open'), station: stationField }),
  z.object({ t: z.literal('task_done'), station: stationField }),
  z.object({ t: z.literal('kill'), target: seatField }),
  z.object({ t: z.literal('report'), body: seatField }),
  z.object({ t: z.literal('emergency') }),
  z.object({ t: z.literal('vent_enter') }),
  z.object({ t: z.literal('vent_exit') }),
  z.object({
    t: z.literal('vent_move'),
    to: z
      .number()
      .int()
      .min(0)
      .max(INF_VENTS.length - 1),
  }),
  z.object({ t: z.literal('sabotage'), kind: z.enum(INF_SABOTAGES) }),
  /** Lights switch or oxygen code finished at panel `panel`. */
  z.object({
    t: z.literal('fix'),
    panel: z.number().int().min(0).max(1),
  }),
  /** Reactor hand scanner pressed / released. */
  z.object({
    t: z.literal('hold'),
    panel: z.number().int().min(0).max(1),
    on: z.boolean(),
  }),
  /** Target seat, or -1 to skip. */
  z.object({
    t: z.literal('vote'),
    target: z
      .number()
      .int()
      .min(-1)
      .max(INF_SEATS - 1),
  }),
]);
export type InfAct = z.infer<typeof infActSchema>;

export const infChatSchema = z.object({
  text: z.string().trim().min(1).max(INF_CHAT_MAX),
});

export type InfLeftReason = 'left' | 'expired' | 'removed';

/** Announcements carry a room-wide sequence number so clients can drop duplicates. */
export interface InfServerEventPayloads {
  'inf:state': InfRoomState;
  'inf:frame': InfFrame;
  'inf:chat': InfChatMessage;
  'inf:rooms_updated': { rooms: InfPublicRoom[] };
  'inf:player_joined': { seq: number; player: InfSeatPlayer };
  'inf:player_left': {
    seq: number;
    seat: number;
    userId: string;
    reason: InfLeftReason;
  };
  'inf:player_disconnected': {
    seq: number;
    seat: number;
    reconnectDeadline: number;
  };
  'inf:player_reconnected': { seq: number; seat: number };
  'inf:match_started': { seq: number };
  'inf:match_over': { seq: number } & InfMatchResult;
}
export type InfServerEventName = keyof InfServerEventPayloads;

export interface InfClientAckData {
  'inf:create': InfSnapshot;
  'inf:watch_rooms': InfPublicRoom[];
  'inf:unwatch_rooms': null;
  'inf:set_visibility': null;
  'inf:set_stake': null;
  'inf:set_rules': null;
  'inf:join': InfSnapshot;
  'inf:sync': InfSnapshot;
  'inf:leave': null;
  'inf:ready': null;
  'inf:set_color': null;
  'inf:add_bot': null;
  'inf:remove_bot': null;
  'inf:start': null;
  'inf:rematch': null;
  'inf:act': null;
  'inf:chat': null;
}

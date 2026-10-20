import { z } from 'zod';
import { roomCodeSchema } from './room';

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

/** Double-six set: 28 tiles from 0|0 (branco) to 6|6 (carroça de seis). */
export const DOMINO_MAX_PIP = 6;

/** A tile with `a <= b` when it is in a hand. */
export interface DominoTile {
  a: number;
  b: number;
}

export const isDouble = (t: DominoTile) => t.a === t.b;
export const tilePips = (t: DominoTile) => t.a + t.b;

export const DOMINO_SIDES = ['left', 'right'] as const;
export type DominoSide = (typeof DOMINO_SIDES)[number];

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const DOMINO_SEATS = 4;
export const DOMINO_MIN_PLAYERS = 2;
export const DOMINO_HAND_SIZE = 7;
/** 0 = single round; otherwise rounds until a seat (or team) reaches the target. */
export const DOMINO_TARGETS = [0, 50, 100] as const;
export type DominoTarget = (typeof DOMINO_TARGETS)[number];

export const dominoRulesSchema = z
  .object({
    target: z.union([z.literal(0), z.literal(50), z.literal(100)]),
    /** 2 against 2 (seats 0+2 vs 1+3). Needs exactly 4 players. */
    teams: z.boolean(),
  })
  .strict();
export type DominoRules = z.infer<typeof dominoRulesSchema>;

export const DEFAULT_DOMINO_RULES: DominoRules = { target: 0, teams: false };

/** Team of a seat in the 2 against 2 mode: partners sit across the table. */
export const dominoTeamOf = (seat: number) => seat % 2;

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export const DOMINO_ROOM_PHASES = ['LOBBY', 'PLAYING', 'FINISHED'] as const;
export type DominoRoomPhase = (typeof DOMINO_ROOM_PHASES)[number];
export type DominoLobbyStatus = 'WAITING_PLAYERS' | 'READY_TO_START';

/** PLAYING while a round runs; ROUND_OVER is the pause before the next deal. */
export type DominoRoundPhase = 'PLAYING' | 'ROUND_OVER';
export type DominoMatchEndReason = 'points' | 'abandoned';

export interface DominoSeatPlayer {
  seat: number;
  userId: string;
  nickname: string;
  character: string | null;
  ready: boolean;
  connected: boolean;
  /** Epoch ms when the reserved seat is released; null while connected. */
  reconnectDeadline: number | null;
}

/** A tile on the table, oriented along the line: `a` touches the left neighbour, `b` the right one. */
export interface DominoPlaced {
  a: number;
  b: number;
  seat: number;
}

export interface DominoRoundResult {
  /** Who won the round (both partners in teams mode); empty when a blocked game tied. */
  winners: number[];
  points: number;
  /** true when nobody could play ("jogo trancado") and the lowest hand won. */
  blocked: boolean;
  /** Pips left in each seat's hand when the round ended. */
  pips: number[];
}

export interface DominoRoundView {
  roundNumber: number;
  phase: DominoRoundPhase;
  turn: number;
  /** The line from its left end to its right end. */
  line: DominoPlaced[];
  /** Index in `line` of the first tile played (the layout grows from it). */
  origin: number;
  /** Open numbers [left, right]; null before the first tile. */
  ends: [number, number] | null;
  boneyard: number;
  /** Tiles in each seat's hand (0 for empty seats and players out of the match). */
  handCounts: number[];
  lastRound: DominoRoundResult | null;
  /** Epoch ms when the turn times out; null between rounds. */
  turnDeadline: number | null;
}

export interface DominoMatchResult {
  /** Empty when the match ended in a tie. */
  winners: number[];
  reason: DominoMatchEndReason;
  scores: number[];
}

/** Public table state: identical for everybody, never contains hidden tiles. */
export interface DominoRoomState {
  code: string;
  version: number;
  hostId: string;
  isPublic: boolean;
  /** Aposta de cada jogador nesta mesa (Arena). */
  stake: number;
  rules: DominoRules;
  phase: DominoRoomPhase;
  lobbyStatus: DominoLobbyStatus | null;
  seats: (DominoSeatPlayer | null)[];
  /** Match points by seat (partners share the same number). */
  scores: number[];
  round: DominoRoundView | null;
  result: DominoMatchResult | null;
}

export interface DominoHandTile {
  id: string;
  tile: DominoTile;
}

export interface DominoPlayable {
  id: string;
  sides: DominoSide[];
}

/** Private state: only ever sent to its owner. */
export interface DominoPrivateHand {
  roundNumber: number;
  tiles: DominoHandTile[];
  /** Tiles the owner may play right now and where (computed by the server). */
  playable: DominoPlayable[];
  /** No tile fits and the boneyard still has tiles. */
  mustDraw: boolean;
}

export interface DominoPublicRoom {
  code: string;
  hostNickname: string;
  hostCharacter: string | null;
  stake: number;
  players: number;
  rules: DominoRules;
}

export const DOMINO_PUBLIC_ROOMS_CHANNEL = 'domino-public-rooms';

export interface DominoSnapshot {
  state: DominoRoomState;
  mySeat: number;
  hand: DominoPrivateHand | null;
}

export const DOMINO_EMOTES = [
  'laugh',
  'shock',
  'angry',
  'clap',
  'fire',
  'pray',
] as const;
export type DominoEmote = (typeof DOMINO_EMOTES)[number];

// ---------------------------------------------------------------------------
// Socket.IO events (namespace /domino)
// ---------------------------------------------------------------------------

export const DOMINO_NAMESPACE = '/domino';

export const DominoClientEvents = {
  CREATE: 'domino:create',
  WATCH_ROOMS: 'domino:watch_rooms',
  UNWATCH_ROOMS: 'domino:unwatch_rooms',
  SET_VISIBILITY: 'domino:set_visibility',
  /** Host only, lobby only: how much each player bets. */
  SET_STAKE: 'domino:set_stake',
  SET_RULES: 'domino:set_rules',
  JOIN: 'domino:join',
  SYNC: 'domino:sync',
  LEAVE: 'domino:leave',
  READY: 'domino:ready',
  START: 'domino:start',
  REMATCH: 'domino:rematch',
  PLAY: 'domino:play',
  DRAW: 'domino:draw',
  EMOTE: 'domino:emote',
} as const;

export const DominoServerEvents = {
  STATE: 'domino:state',
  PRIVATE_HAND: 'domino:private_hand',
  ROOMS_UPDATED: 'domino:rooms_updated',
  ROOM_CLOSED: 'domino:room_closed',
  EMOTED: 'domino:emoted',
  PLAYER_JOINED: 'domino:player_joined',
  PLAYER_LEFT: 'domino:player_left',
  PLAYER_DISCONNECTED: 'domino:player_disconnected',
  PLAYER_RECONNECTED: 'domino:player_reconnected',
  MATCH_STARTED: 'domino:match_started',
  ROUND_STARTED: 'domino:round_started',
  TILE_PLAYED: 'domino:tile_played',
  TILES_DRAWN: 'domino:tiles_drawn',
  TURN_PASSED: 'domino:turn_passed',
  TURN_TIMED_OUT: 'domino:turn_timed_out',
  ROUND_ENDED: 'domino:round_ended',
  MATCH_OVER: 'domino:match_over',
} as const;

const actionIdSchema = z.string().min(8).max(64);

export const dominoEmptySchema = z.object({}).strict();
export const dominoCreateSchema = z
  .object({ isPublic: z.boolean().default(true) })
  .strict();
export const dominoVisibilitySchema = z.object({ isPublic: z.boolean() });
export const dominoSetRulesSchema = z.object({ rules: dominoRulesSchema });
export const dominoJoinSchema = z.object({ code: roomCodeSchema });
export const dominoReadySchema = z.object({ ready: z.boolean() });
export const dominoActionSchema = z.object({ actionId: actionIdSchema });
export const dominoPlaySchema = z.object({
  actionId: actionIdSchema,
  tileId: z.string().min(1).max(32),
  /** Needed only when the tile fits both ends with different numbers. */
  side: z.enum(DOMINO_SIDES).optional(),
});
export const dominoEmoteSchema = z.object({ emote: z.enum(DOMINO_EMOTES) });

export type DominoLeftReason = 'left' | 'expired';

/** Every announcement carries a room-wide sequence number so clients can drop duplicates. */
export interface DominoServerEventPayloads {
  'domino:state': DominoRoomState;
  'domino:private_hand': DominoPrivateHand;
  'domino:rooms_updated': { rooms: DominoPublicRoom[] };
  'domino:room_closed': { reason: 'empty' };
  'domino:emoted': { seat: number; emote: DominoEmote };
  'domino:player_joined': { seq: number; player: DominoSeatPlayer };
  'domino:player_left': {
    seq: number;
    seat: number;
    userId: string;
    reason: DominoLeftReason;
  };
  'domino:player_disconnected': {
    seq: number;
    seat: number;
    reconnectDeadline: number;
  };
  'domino:player_reconnected': { seq: number; seat: number };
  'domino:match_started': { seq: number };
  'domino:round_started': { seq: number; roundNumber: number; starter: number };
  'domino:tile_played': {
    seq: number;
    seat: number;
    tile: DominoTile;
    side: DominoSide;
    tilesLeft: number;
  };
  'domino:tiles_drawn': { seq: number; seat: number; count: number };
  'domino:turn_passed': { seq: number; seat: number };
  'domino:turn_timed_out': { seq: number; seat: number };
  'domino:round_ended': { seq: number; scores: number[] } & DominoRoundResult;
  'domino:match_over': { seq: number } & DominoMatchResult;
}
export type DominoServerEventName = keyof DominoServerEventPayloads;

export interface DominoClientAckData {
  'domino:create': DominoSnapshot;
  'domino:watch_rooms': DominoPublicRoom[];
  'domino:unwatch_rooms': null;
  'domino:set_visibility': null;
  'domino:set_stake': null;
  'domino:set_rules': null;
  'domino:join': DominoSnapshot;
  'domino:sync': DominoSnapshot;
  'domino:leave': null;
  'domino:ready': null;
  'domino:start': null;
  'domino:rematch': null;
  'domino:play': null;
  'domino:draw': null;
  'domino:emote': null;
}

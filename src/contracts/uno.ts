import { z } from 'zod';
import { roomCodeSchema } from './room';

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export const UNO_COLORS = ['red', 'yellow', 'green', 'blue'] as const;
export type UnoColor = (typeof UNO_COLORS)[number];

/** draw2 = +2, wild = Coringa, wild4 = Coringa +4. */
export const UNO_VALUES = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'skip',
  'reverse',
  'draw2',
  'wild',
  'wild4',
] as const;
export type UnoValue = (typeof UNO_VALUES)[number];

/** Wild cards have color 'wild'; the color they become lives in the round view. */
export interface UnoCard {
  color: UnoColor | 'wild';
  value: UnoValue;
}

export const isWild = (card: UnoCard) => card.color === 'wild';

/** Official scoring: numbers by face value, action cards 20, wild cards 50. */
export function cardPoints(card: UnoCard): number {
  if (card.value === 'wild' || card.value === 'wild4') return 50;
  if (
    card.value === 'skip' ||
    card.value === 'reverse' ||
    card.value === 'draw2'
  )
    return 20;
  return Number(card.value);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const UNO_SEATS = 6;
export const UNO_MIN_PLAYERS = 2;
export const UNO_HAND_SIZE = 7;
/** 0 = single round (whoever empties the hand first wins the match). */
export const UNO_TARGETS = [0, 200, 500] as const;
export type UnoTarget = (typeof UNO_TARGETS)[number];

export const unoRulesSchema = z
  .object({
    target: z.union([z.literal(0), z.literal(200), z.literal(500)]),
    /** +2 on +2, +4 on +2 or +4: the victim passes the sum on or draws it all. */
    stacking: z.boolean(),
    /** 7 swaps hands with a chosen player; 0 rotates every hand along the play direction. */
    sevenZero: z.boolean(),
  })
  .strict();
export type UnoRules = z.infer<typeof unoRulesSchema>;

export const DEFAULT_UNO_RULES: UnoRules = {
  target: 0,
  stacking: false,
  sevenZero: false,
};

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export const UNO_ROOM_PHASES = ['LOBBY', 'PLAYING', 'FINISHED'] as const;
export type UnoRoomPhase = (typeof UNO_ROOM_PHASES)[number];
export type UnoLobbyStatus = 'WAITING_PLAYERS' | 'READY_TO_START';

/** PLAYING while a round runs; ROUND_OVER is the pause before the next deal. */
export type UnoRoundPhase = 'PLAYING' | 'ROUND_OVER';
export type UnoDirection = 1 | -1;
export type UnoMatchEndReason = 'points' | 'abandoned';

export interface UnoSeatPlayer {
  seat: number;
  userId: string;
  nickname: string;
  character: string | null;
  ready: boolean;
  connected: boolean;
  /** Epoch ms when the reserved seat is released; null while connected. */
  reconnectDeadline: number | null;
}

export interface UnoRoundResult {
  winner: number;
  points: number;
}

export interface UnoRoundView {
  roundNumber: number;
  phase: UnoRoundPhase;
  turn: number;
  direction: UnoDirection;
  topCard: UnoCard;
  /** Color to follow (the chosen one after a wild). */
  color: UnoColor;
  drawPile: number;
  discardCount: number;
  /** Cards in each seat's hand (0 for empty seats and players out of the match). */
  handCounts: number[];
  /** Cards the turn player must draw unless they stack or challenge. */
  pendingDraw: number;
  /** The turn player may challenge the +4 on top. */
  canChallenge: boolean;
  /** The turn player drew a playable card and is choosing to play it or keep it. */
  awaitingDrawn: boolean;
  saidUno: boolean[];
  /** Seat with one card that did not say UNO and can still be caught. */
  unoExposed: number | null;
  lastRound: UnoRoundResult | null;
  /** Epoch ms when the turn times out; null between rounds. */
  turnDeadline: number | null;
}

export interface UnoMatchResult {
  winner: number;
  reason: UnoMatchEndReason;
  scores: number[];
}

/** Public table state: identical for everybody, never contains hidden cards. */
export interface UnoRoomState {
  code: string;
  version: number;
  hostId: string;
  isPublic: boolean;
  /** Aposta de cada jogador nesta mesa (Arena). */
  stake: number;
  rules: UnoRules;
  phase: UnoRoomPhase;
  lobbyStatus: UnoLobbyStatus | null;
  seats: (UnoSeatPlayer | null)[];
  /** Match points by seat. */
  scores: number[];
  round: UnoRoundView | null;
  result: UnoMatchResult | null;
}

export interface UnoHandCard {
  id: string;
  card: UnoCard;
}

/** Private state: only ever sent to its owner. */
export interface UnoPrivateHand {
  roundNumber: number;
  cards: UnoHandCard[];
  /** Ids the owner may play right now (computed by the server). */
  playable: string[];
  /** Card just drawn while deciding to play it or keep it. */
  drawnCardId: string | null;
}

export interface UnoPublicRoom {
  code: string;
  hostNickname: string;
  hostCharacter: string | null;
  stake: number;
  players: number;
  rules: UnoRules;
}

export const UNO_PUBLIC_ROOMS_CHANNEL = 'uno-public-rooms';

export interface UnoSnapshot {
  state: UnoRoomState;
  mySeat: number;
  hand: UnoPrivateHand | null;
}

export const UNO_EMOTES = [
  'laugh',
  'shock',
  'angry',
  'clap',
  'fire',
  'pray',
] as const;
export type UnoEmote = (typeof UNO_EMOTES)[number];

// ---------------------------------------------------------------------------
// Socket.IO events (namespace /uno)
// ---------------------------------------------------------------------------

export const UNO_NAMESPACE = '/uno';

export const UnoClientEvents = {
  CREATE: 'uno:create',
  WATCH_ROOMS: 'uno:watch_rooms',
  UNWATCH_ROOMS: 'uno:unwatch_rooms',
  SET_VISIBILITY: 'uno:set_visibility',
  /** Host only, lobby only: how much each player bets. */
  SET_STAKE: 'uno:set_stake',
  SET_RULES: 'uno:set_rules',
  JOIN: 'uno:join',
  SYNC: 'uno:sync',
  LEAVE: 'uno:leave',
  READY: 'uno:ready',
  START: 'uno:start',
  REMATCH: 'uno:rematch',
  PLAY_CARD: 'uno:play_card',
  DRAW: 'uno:draw',
  PASS: 'uno:pass',
  CHALLENGE: 'uno:challenge',
  CALL_UNO: 'uno:call_uno',
  CATCH_UNO: 'uno:catch_uno',
  EMOTE: 'uno:emote',
} as const;

export const UnoServerEvents = {
  STATE: 'uno:state',
  PRIVATE_HAND: 'uno:private_hand',
  ROOMS_UPDATED: 'uno:rooms_updated',
  ROOM_CLOSED: 'uno:room_closed',
  EMOTED: 'uno:emoted',
  PLAYER_JOINED: 'uno:player_joined',
  PLAYER_LEFT: 'uno:player_left',
  PLAYER_DISCONNECTED: 'uno:player_disconnected',
  PLAYER_RECONNECTED: 'uno:player_reconnected',
  MATCH_STARTED: 'uno:match_started',
  ROUND_STARTED: 'uno:round_started',
  CARD_PLAYED: 'uno:card_played',
  CARDS_DRAWN: 'uno:cards_drawn',
  TURN_SKIPPED: 'uno:turn_skipped',
  DIRECTION_CHANGED: 'uno:direction_changed',
  HANDS_SWAPPED: 'uno:hands_swapped',
  HANDS_ROTATED: 'uno:hands_rotated',
  CHALLENGE_RESOLVED: 'uno:challenge_resolved',
  UNO_CALLED: 'uno:uno_called',
  UNO_CAUGHT: 'uno:uno_caught',
  TURN_TIMED_OUT: 'uno:turn_timed_out',
  ROUND_ENDED: 'uno:round_ended',
  MATCH_OVER: 'uno:match_over',
} as const;

const actionIdSchema = z.string().min(8).max(64);

export const unoEmptySchema = z.object({}).strict();
export const unoCreateSchema = z
  .object({ isPublic: z.boolean().default(true) })
  .strict();
export const unoVisibilitySchema = z.object({ isPublic: z.boolean() });
export const unoSetRulesSchema = z.object({ rules: unoRulesSchema });
export const unoJoinSchema = z.object({ code: roomCodeSchema });
export const unoReadySchema = z.object({ ready: z.boolean() });
export const unoActionSchema = z.object({ actionId: actionIdSchema });
export const unoPlayCardSchema = z.object({
  actionId: actionIdSchema,
  cardId: z.string().min(1).max(32),
  /** Required for wild cards. */
  color: z.enum(UNO_COLORS).optional(),
  /** Required for a 7 with the 7-0 rule: whose hand to take. */
  target: z
    .number()
    .int()
    .min(0)
    .max(UNO_SEATS - 1)
    .optional(),
});
export type UnoPlayOptions = Pick<
  z.infer<typeof unoPlayCardSchema>,
  'color' | 'target'
>;
export const unoEmoteSchema = z.object({ emote: z.enum(UNO_EMOTES) });

export type UnoLeftReason = 'left' | 'expired';
/** choice = drew on purpose; penalty = +2/+4/stack; challenge = lost (or was caught by) a challenge. */
export type UnoDrawReason =
  'choice' | 'penalty' | 'challenge' | 'uno' | 'timeout';

/** Every announcement carries a room-wide sequence number so clients can drop duplicates. */
export interface UnoServerEventPayloads {
  'uno:state': UnoRoomState;
  'uno:private_hand': UnoPrivateHand;
  'uno:rooms_updated': { rooms: UnoPublicRoom[] };
  'uno:room_closed': { reason: 'empty' };
  'uno:emoted': { seat: number; emote: UnoEmote };
  'uno:player_joined': { seq: number; player: UnoSeatPlayer };
  'uno:player_left': {
    seq: number;
    seat: number;
    userId: string;
    reason: UnoLeftReason;
  };
  'uno:player_disconnected': {
    seq: number;
    seat: number;
    reconnectDeadline: number;
  };
  'uno:player_reconnected': { seq: number; seat: number };
  'uno:match_started': { seq: number };
  'uno:round_started': {
    seq: number;
    roundNumber: number;
    starter: number;
    topCard: UnoCard;
  };
  'uno:card_played': {
    seq: number;
    seat: number;
    card: UnoCard;
    color: UnoColor;
    cardsLeft: number;
  };
  'uno:cards_drawn': {
    seq: number;
    seat: number;
    count: number;
    reason: UnoDrawReason;
  };
  'uno:turn_skipped': { seq: number; seat: number };
  'uno:direction_changed': { seq: number; direction: UnoDirection };
  'uno:hands_swapped': { seq: number; seat: number; target: number };
  'uno:hands_rotated': { seq: number; direction: UnoDirection };
  'uno:challenge_resolved': {
    seq: number;
    challenger: number;
    target: number;
    bluffed: boolean;
  };
  'uno:uno_called': { seq: number; seat: number };
  'uno:uno_caught': { seq: number; seat: number; by: number };
  'uno:turn_timed_out': { seq: number; seat: number };
  'uno:round_ended': {
    seq: number;
    winner: number;
    points: number;
    scores: number[];
  };
  'uno:match_over': { seq: number } & UnoMatchResult;
}
export type UnoServerEventName = keyof UnoServerEventPayloads;

export interface UnoClientAckData {
  'uno:create': UnoSnapshot;
  'uno:watch_rooms': UnoPublicRoom[];
  'uno:unwatch_rooms': null;
  'uno:set_visibility': null;
  'uno:set_stake': null;
  'uno:set_rules': null;
  'uno:join': UnoSnapshot;
  'uno:sync': UnoSnapshot;
  'uno:leave': null;
  'uno:ready': null;
  'uno:start': null;
  'uno:rematch': null;
  'uno:play_card': null;
  'uno:draw': null;
  'uno:pass': null;
  'uno:challenge': null;
  'uno:call_uno': null;
  'uno:catch_uno': null;
  'uno:emote': null;
}

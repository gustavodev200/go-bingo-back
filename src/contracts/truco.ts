import { z } from 'zod';
import { roomCodeSchema } from './room';

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** clubs = paus, hearts = copas, spades = espadas, diamonds = ouros. */
export const TRUCO_SUITS = ['clubs', 'hearts', 'spades', 'diamonds'] as const;
export type TrucoSuit = (typeof TRUCO_SUITS)[number];

/** 40-card deck: no jokers, 8, 9 or 10. Q = Dama, J = Valete, K = Rei. */
export const TRUCO_RANKS = [
  '4',
  '5',
  '6',
  '7',
  'Q',
  'J',
  'K',
  'A',
  '2',
  '3',
] as const;
export type TrucoRank = (typeof TRUCO_RANKS)[number];

export const trucoCardSchema = z.object({
  rank: z.enum(TRUCO_RANKS),
  suit: z.enum(TRUCO_SUITS),
});
export type TrucoCard = z.infer<typeof trucoCardSchema>;

/** Fixed manilhas of Truco Mineiro, strongest first. */
export const MANILHAS = [
  { rank: '4', suit: 'clubs', name: 'Zap' },
  { rank: '7', suit: 'hearts', name: 'Copeta' },
  { rank: 'A', suit: 'spades', name: 'Espadilha' },
  { rank: '7', suit: 'diamonds', name: 'Pica-fumo' },
] as const satisfies readonly (TrucoCard & { name: string })[];

export function manilhaName(card: TrucoCard): string | null {
  return (
    MANILHAS.find((m) => m.rank === card.rank && m.suit === card.suit)?.name ??
    null
  );
}

// ---------------------------------------------------------------------------
// Rules constants
// ---------------------------------------------------------------------------

export const TRUCO_SEATS = 4;
export const TRUCO_TARGET_SCORE = 12;
/** Hand value ladder: a plain hand is worth 1, then truco (3), seis (6), nove (9), doze (12). */
export const TRUCO_BET_LADDER = [1, 3, 6, 9, 12] as const;
export const TRUCO_TEN_HAND_VALUE = 4;
export const TRUCO_TEN_HAND_RUN_POINTS = 2;
/** Mão de ferro is a plain hand (no truco): worth the base value. */
export const TRUCO_IRON_HAND_VALUE = 1;
export const TRUCO_TEN_THRESHOLD = 10;

export type Seat = 0 | 1 | 2 | 3;
/** Team 0 = seats 0 and 2; team 1 = seats 1 and 3 (partners sit across). */
export type Team = 0 | 1;
export const teamOf = (seat: Seat): Team => (seat % 2) as Team;
export const partnerOf = (seat: Seat): Seat => ((seat + 2) % 4) as Seat;

export const BET_NAMES: Record<number, string> = {
  3: 'Truco',
  6: 'Seis',
  9: 'Nove',
  12: 'Doze',
};

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export const TRUCO_ROOM_PHASES = ['LOBBY', 'PLAYING', 'FINISHED'] as const;
export type TrucoRoomPhase = (typeof TRUCO_ROOM_PHASES)[number];

export type TrucoLobbyStatus = 'WAITING_PLAYERS' | 'READY_TO_START';

/** DEALING is transient on the server; HAND_OVER is the pause before the next deal. */
export const TRUCO_HAND_PHASES = [
  'DEALING',
  'AWAITING_TEN_DECISION',
  'AWAITING_PLAY',
  'AWAITING_BET_RESPONSE',
  'HAND_OVER',
] as const;
export type TrucoHandPhase = (typeof TRUCO_HAND_PHASES)[number];

/** normal; ten = mão de dez (one team at 10); iron = mão de ferro (10 x 10, blind cards). */
export type TrucoHandKind = 'normal' | 'ten' | 'iron';

export type TrucoHandEndReason =
  'rounds' | 'bet_declined' | 'ten_declined' | 'void';
export type TrucoMatchEndReason = 'points' | 'abandoned';

export interface TrucoSeatPlayer {
  seat: Seat;
  team: Team;
  userId: string;
  nickname: string;
  character: string | null;
  ready: boolean;
  connected: boolean;
  /** Epoch ms when the reserved seat is released; null while connected. */
  reconnectDeadline: number | null;
}

export interface TrucoPlay {
  seat: Seat;
  card: TrucoCard;
}

export interface TrucoRoundView {
  plays: TrucoPlay[];
  /** null while the round is still being played. */
  result: Team | 'tie' | null;
  /** Seat that played the best card (first one, on ties). */
  winningSeat: Seat | null;
}

export interface TrucoPendingBet {
  value: number;
  requestedBy: Seat;
  team: Team;
}

export interface TrucoHandResult {
  winnerTeam: Team | null;
  points: number;
  reason: TrucoHandEndReason;
}

export interface TrucoMatchView {
  handNumber: number;
  dealer: Seat;
  phase: TrucoHandPhase;
  kind: TrucoHandKind;
  /** Team at 10 deciding the mão de dez; null otherwise. */
  tenTeam: Team | null;
  /** Current accepted hand value. */
  value: number;
  pendingBet: TrucoPendingBet | null;
  /** Team that made the last accepted raise (cannot raise again). */
  lastRaiseTeam: Team | null;
  turn: Seat;
  rounds: TrucoRoundView[];
  cardsLeft: [number, number, number, number];
  lastHandResult: TrucoHandResult | null;
}

export interface TrucoMatchResult {
  winnerTeam: Team;
  reason: TrucoMatchEndReason;
  scores: [number, number];
}

/** Public table state: identical for the 4 players, never contains hidden cards. */
export interface TrucoRoomState {
  code: string;
  version: number;
  hostId: string;
  /** Public tables are listed in the truco lobby; private ones are joined by code only. */
  isPublic: boolean;
  phase: TrucoRoomPhase;
  lobbyStatus: TrucoLobbyStatus | null;
  seats: (TrucoSeatPlayer | null)[];
  scores: [number, number];
  match: TrucoMatchView | null;
  result: TrucoMatchResult | null;
}

/** A card in the player's own hand. `card` is null in the mão de ferro (blind). */
export interface TrucoHandCard {
  id: string;
  card: TrucoCard | null;
}

/** Private state: only ever sent to its owner. */
export interface TrucoPrivateHand {
  handNumber: number;
  cards: TrucoHandCard[];
  /** Partner cards, shown only to the team at 10 while it decides the mão de dez. */
  partnerCards: TrucoCard[] | null;
}

/** A public table still taking players, as listed in the truco lobby. */
export interface TrucoPublicRoom {
  code: string;
  hostNickname: string;
  hostCharacter: string | null;
  players: number;
}

/** Room for the lobby watchers channel (inside the /truco namespace). */
export const TRUCO_PUBLIC_ROOMS_CHANNEL = 'truco-public-rooms';

export interface TrucoSnapshot {
  state: TrucoRoomState;
  mySeat: Seat;
  hand: TrucoPrivateHand | null;
}

// ---------------------------------------------------------------------------
// Secret signals
// ---------------------------------------------------------------------------

/** Gestures only. Their meaning is a convention kept on each player's device. */
export const TRUCO_GESTURES = [
  'wink',
  'eyebrow',
  'pout',
  'tongue',
  'nose',
  'shoulder',
] as const;
export type TrucoGesture = (typeof TRUCO_GESTURES)[number];

// ---------------------------------------------------------------------------
// Socket.IO events (namespace /truco)
// ---------------------------------------------------------------------------

export const TRUCO_NAMESPACE = '/truco';

export const TrucoClientEvents = {
  CREATE: 'truco:create',
  WATCH_ROOMS: 'truco:watch_rooms',
  UNWATCH_ROOMS: 'truco:unwatch_rooms',
  SET_VISIBILITY: 'truco:set_visibility',
  JOIN: 'truco:join',
  LEAVE: 'truco:leave',
  TAKE_SEAT: 'truco:take_seat',
  READY: 'truco:ready',
  START: 'truco:start',
  PLAY_CARD: 'truco:play_card',
  REQUEST_BET: 'truco:request_bet',
  RESPOND_BET: 'truco:respond_bet',
  TEN_DECISION: 'truco:ten_decision',
  SIGNAL: 'truco:signal',
  SYNC: 'truco:sync',
  REMATCH: 'truco:rematch',
} as const;

export const TrucoServerEvents = {
  STATE: 'truco:state',
  PRIVATE_HAND: 'truco:private_hand',
  PLAYER_JOINED: 'truco:player_joined',
  PLAYER_LEFT: 'truco:player_left',
  PLAYER_DISCONNECTED: 'truco:player_disconnected',
  PLAYER_RECONNECTED: 'truco:player_reconnected',
  MATCH_STARTED: 'truco:match_started',
  HAND_DEALT: 'truco:hand_dealt',
  CARD_PLAYED: 'truco:card_played',
  ROUND_ENDED: 'truco:round_ended',
  HAND_ENDED: 'truco:hand_ended',
  BET_REQUESTED: 'truco:bet_requested',
  BET_RESOLVED: 'truco:bet_resolved',
  TEN_DECIDED: 'truco:ten_decided',
  SCORE_UPDATED: 'truco:score_updated',
  MATCH_OVER: 'truco:match_over',
  SIGNAL_RECEIVED: 'truco:signal_received',
  GESTURED: 'truco:gestured',
  ROOM_CLOSED: 'truco:room_closed',
  ROOMS_UPDATED: 'truco:rooms_updated',
} as const;

const actionIdSchema = z.string().min(8).max(64);

export const trucoEmptySchema = z.object({}).strict();
/** Absent isPublic (older clients) = public. */
export const trucoCreateSchema = z
  .object({ isPublic: z.boolean().default(true) })
  .strict();
export const trucoVisibilitySchema = z.object({ isPublic: z.boolean() });
export const trucoJoinSchema = z.object({ code: roomCodeSchema });
export const trucoTakeSeatSchema = z.object({
  seat: z.number().int().min(0).max(3),
});
export const trucoReadySchema = z.object({ ready: z.boolean() });
export const trucoPlayCardSchema = z.object({
  actionId: actionIdSchema,
  cardId: z.string().min(1).max(32),
});
export const trucoRequestBetSchema = z.object({ actionId: actionIdSchema });
export const trucoRespondBetSchema = z.object({
  actionId: actionIdSchema,
  response: z.enum(['accept', 'run', 'raise']),
});
export type TrucoBetResponse = z.infer<
  typeof trucoRespondBetSchema
>['response'];
export const trucoTenDecisionSchema = z.object({
  actionId: actionIdSchema,
  play: z.boolean(),
});
export const trucoSignalSchema = z.object({
  gesture: z.enum(TRUCO_GESTURES),
});

export type TrucoLeftReason = 'left' | 'expired';
export type TrucoClosedReason = 'empty';

/** Every announcement carries a room-wide sequence number so clients can drop duplicates. */
export interface TrucoServerEventPayloads {
  'truco:state': TrucoRoomState;
  'truco:private_hand': TrucoPrivateHand;
  'truco:player_joined': { seq: number; player: TrucoSeatPlayer };
  'truco:player_left': {
    seq: number;
    seat: Seat;
    userId: string;
    reason: TrucoLeftReason;
  };
  'truco:player_disconnected': {
    seq: number;
    seat: Seat;
    reconnectDeadline: number;
  };
  'truco:player_reconnected': { seq: number; seat: Seat };
  'truco:match_started': { seq: number };
  'truco:hand_dealt': {
    seq: number;
    handNumber: number;
    kind: TrucoHandKind;
    tenTeam: Team | null;
  };
  'truco:card_played': {
    seq: number;
    seat: Seat;
    card: TrucoCard;
    round: number;
  };
  'truco:round_ended': {
    seq: number;
    round: number;
    result: Team | 'tie';
    winningSeat: Seat;
  };
  'truco:hand_ended': { seq: number } & TrucoHandResult;
  'truco:bet_requested': {
    seq: number;
    seat: Seat;
    team: Team;
    value: number;
  };
  'truco:bet_resolved': {
    seq: number;
    seat: Seat;
    response: 'accept' | 'run';
    value: number;
  };
  'truco:ten_decided': { seq: number; seat: Seat; play: boolean };
  'truco:score_updated': { seq: number; scores: [number, number] };
  'truco:match_over': { seq: number } & TrucoMatchResult;
  'truco:signal_received': { fromSeat: Seat; gesture: TrucoGesture };
  'truco:gestured': { seat: Seat };
  'truco:room_closed': { reason: TrucoClosedReason };
  'truco:rooms_updated': { rooms: TrucoPublicRoom[] };
}
export type TrucoServerEventName = keyof TrucoServerEventPayloads;

export interface TrucoClientAckData {
  'truco:create': TrucoSnapshot;
  'truco:watch_rooms': TrucoPublicRoom[];
  'truco:unwatch_rooms': null;
  'truco:set_visibility': null;
  'truco:join': TrucoSnapshot;
  'truco:leave': null;
  'truco:take_seat': null;
  'truco:ready': null;
  'truco:start': null;
  'truco:play_card': null;
  'truco:request_bet': null;
  'truco:respond_bet': null;
  'truco:ten_decision': null;
  'truco:signal': null;
  'truco:sync': TrucoSnapshot;
  'truco:rematch': null;
}

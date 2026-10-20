import { z } from 'zod';
import { roomCodeSchema } from './room';

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * Carta em 2 caracteres: valor (A 2–9 T J Q K) + naipe (S espadas, H copas,
 * D ouros, C paus). "TH" = 10 de copas.
 */
export const BJ_RANKS = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'T',
  'J',
  'Q',
  'K',
] as const;
export type BjRank = (typeof BJ_RANKS)[number];
export const BJ_SUITS = ['S', 'H', 'D', 'C'] as const;
export type BjSuit = (typeof BJ_SUITS)[number];
export type BjCard = `${BjRank}${BjSuit}`;

export const bjRank = (card: BjCard) => card[0] as BjRank;
export const bjSuit = (card: BjCard) => card[1] as BjSuit;

/** Valor de uma carta: figuras e 10 valem 10, Ás vale 1 (o 11 entra em bjTotal). */
export function bjCardValue(card: BjCard): number {
  const rank = bjRank(card);
  if (rank === 'A') return 1;
  if (rank === 'T' || rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

/** Melhor total da mão (um Ás vira 11 se não estourar) e se ela é "mole" (Ás contando 11). */
export function bjTotal(cards: readonly BjCard[]): {
  total: number;
  soft: boolean;
} {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += bjCardValue(c);
    if (bjRank(c) === 'A') aces++;
  }
  if (aces > 0 && total + 10 <= 21) return { total: total + 10, soft: true };
  return { total, soft: false };
}

/** Blackjack natural: 21 com as duas primeiras cartas (não vale em mão dividida). */
export const isBlackjack = (cards: readonly BjCard[]) =>
  cards.length === 2 && bjTotal(cards).total === 21;

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

/** Lugares na mesa (todos contra o dealer). */
export const BJ_SEATS = 5;
/** Fichas de cada jogador no começo da partida (torneio: vence quem terminar com mais). */
export const BJ_START_CHIPS = 1000;
/** Limites da mesa por mão; apostas sempre em múltiplos de BJ_BET_STEP. */
export const BJ_MIN_BET = 10;
export const BJ_MAX_BET = 500;
export const BJ_BET_STEP = 10;
/** Fichas do painel de aposta. */
export const BJ_CHIP_VALUES = [10, 50, 100, 500] as const;
/** Tempo para apostar; acabou, quem não apostou entra com a mínima. */
export const BJ_BET_SECONDS = 20;
/** Tempo para decidir o seguro; acabou, quem não respondeu fica sem. */
export const BJ_INSURANCE_SECONDS = 10;
/** Pausa com o resultado da rodada na mesa (mais um pouco por carta que o dealer comprou). */
export const BJ_SETTLE_PAUSE_MS = 4_000;
export const BJ_DEALER_CARD_MS = 650;
/** O sapato é embaralhado de novo quando sobra menos que isto (carta de corte). */
export const BJ_RESHUFFLE_AT = 0.25;
/** Mãos por jogador depois de dividir (só se divide uma vez). */
export const BJ_MAX_HANDS = 2;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const BJ_ROUNDS = [5, 10, 15] as const;
export const BJ_TURN_SECONDS = [15, 30] as const;
export const BJ_DECKS = [2, 6] as const;
export const BJ_PAYOUTS = ['3:2', '6:5'] as const;
export type BjPayout = (typeof BJ_PAYOUTS)[number];

export const bjRulesSchema = z
  .object({
    /** Rodadas da partida; no fim, a colocação é pelas fichas. */
    rounds: z.union([z.literal(5), z.literal(10), z.literal(15)]),
    /** Quanto paga um blackjack natural. */
    payout: z.enum(BJ_PAYOUTS),
    /** Baralhos no sapato. Render (desistir) só existe no sapato de 6. */
    decks: z.union([z.literal(2), z.literal(6)]),
    /** Tempo de cada decisão; acabou, a mão para (stand). */
    turnSeconds: z.union([z.literal(15), z.literal(30)]),
  })
  .strict();
export type BjRules = z.infer<typeof bjRulesSchema>;

export const DEFAULT_BJ_RULES: BjRules = {
  rounds: 10,
  payout: '3:2',
  decks: 6,
  turnSeconds: 15,
};

/** Render só no sapato de 6 baralhos (no Double Deck não existe). */
export const bjSurrenderAllowed = (rules: Pick<BjRules, 'decks'>) =>
  rules.decks === 6;

/** Lucro de um blackjack natural para uma aposta (sempre inteiro: apostas são múltiplos de 10). */
export function bjBlackjackProfit(bet: number, payout: BjPayout): number {
  return payout === '3:2' ? (bet * 3) / 2 : (bet * 6) / 5;
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export const BJ_ROOM_PHASES = ['LOBBY', 'PLAYING', 'FINISHED'] as const;
export type BjRoomPhase = (typeof BJ_ROOM_PHASES)[number];
export type BjLobbyStatus = 'WAITING_PLAYERS' | 'READY_TO_START';

/** Etapa da rodada em andamento. */
export type BjStage = 'BETTING' | 'INSURANCE' | 'PLAYING' | 'SETTLED';

export type BjAction = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

export type BjHandStatus =
  'playing' | 'stood' | 'bust' | 'blackjack' | 'doubled' | 'surrendered';

export type BjOutcome = 'win' | 'blackjack' | 'push' | 'lose' | 'surrender';

export interface BjSeatPlayer {
  seat: number;
  userId: string;
  nickname: string;
  character: string | null;
  ready: boolean;
  connected: boolean;
  /** Epoch ms when the reserved seat is released; null while connected. */
  reconnectDeadline: number | null;
}

export interface BjHandView {
  cards: BjCard[];
  /** Fichas apostadas nesta mão (dobra já somada). */
  bet: number;
  total: number;
  soft: boolean;
  status: BjHandStatus;
  /** Veio de uma divisão (21 aqui não é blackjack). */
  split: boolean;
  /** Resultado depois que a rodada fecha. */
  outcome: BjOutcome | null;
  /** Lucro (ou prejuízo) da mão na rodada; 0 até fechar. */
  net: number;
}

export interface BjPlayerView {
  seat: number;
  /** Fichas fora da mesa (o que está apostado já saiu daqui). */
  chips: number;
  /** Aposta desta rodada; null enquanto não apostou. */
  bet: number | null;
  hands: BjHandView[];
  /** Seguro: null = não decidiu / não ofereceram, 0 = recusou, > 0 = valor. */
  insurance: number | null;
  /** Lucro do seguro quando a rodada fecha (2:1 ou perde). */
  insuranceNet: number;
  /** Ficou sem fichas para a aposta mínima: assiste até o fim. */
  broke: boolean;
  /** Saiu (ou não voltou a tempo) no meio da partida. */
  left: boolean;
  /** Lucro total da rodada que fechou (mãos + seguro). */
  roundNet: number;
}

export interface BjDealerView {
  /** null = carta virada para baixo (a segunda, até o dealer jogar). */
  cards: (BjCard | null)[];
  /** Total do que está à mostra. */
  total: number;
  soft: boolean;
  blackjack: boolean;
}

export interface BjGameView {
  /** Rodada atual, de 1 a rules.rounds. */
  round: number;
  stage: BjStage;
  dealer: BjDealerView;
  /** Por lugar; null = lugar fora desta partida. */
  players: (BjPlayerView | null)[];
  /** De quem é a vez (lugar e mão) na etapa PLAYING. */
  turn: { seat: number; hand: number } | null;
  /** O que a mão da vez pode fazer agora. */
  actions: BjAction[];
  /** Cartas ainda no sapato e o total dele. */
  shoeLeft: number;
  shoeSize: number;
  /** Epoch ms do fim da etapa (aposta, seguro, decisão ou pausa); null quando acabou. */
  deadline: number | null;
}

export type BjEndReason =
  /** Todas as rodadas foram jogadas. */
  | 'rounds'
  /** Todo mundo ficou sem fichas. */
  | 'broke'
  /** Só sobrou um jogador na mesa. */
  | 'abandoned';

export interface BjStanding {
  seat: number;
  userId: string;
  nickname: string;
  chips: number;
  /** 1 = mais fichas; empates dividem a colocação. Quem saiu fica por último. */
  placement: number;
  left: boolean;
}

export interface BjMatchResult {
  reason: BjEndReason;
  /** Da melhor para a pior colocação. */
  standings: BjStanding[];
}

/** Public table state: identical for everybody (the hole card stays null until the dealer plays). */
export interface BjRoomState {
  code: string;
  version: number;
  hostId: string;
  isPublic: boolean;
  /** Aposta de cada jogador nesta mesa (Arena). */
  stake: number;
  rules: BjRules;
  phase: BjRoomPhase;
  lobbyStatus: BjLobbyStatus | null;
  seats: (BjSeatPlayer | null)[];
  game: BjGameView | null;
  result: BjMatchResult | null;
}

export interface BjPublicRoom {
  code: string;
  hostNickname: string;
  hostCharacter: string | null;
  stake: number;
  players: number;
  rules: BjRules;
}

export const BJ_PUBLIC_ROOMS_CHANNEL = 'blackjack-public-rooms';

export interface BjSnapshot {
  state: BjRoomState;
  mySeat: number;
}

export const BJ_EMOTES = [
  'laugh',
  'shock',
  'angry',
  'clap',
  'fire',
  'pray',
] as const;
export type BjEmote = (typeof BJ_EMOTES)[number];

// ---------------------------------------------------------------------------
// Socket.IO events (namespace /blackjack)
// ---------------------------------------------------------------------------

export const BJ_NAMESPACE = '/blackjack';

export const BjClientEvents = {
  CREATE: 'blackjack:create',
  WATCH_ROOMS: 'blackjack:watch_rooms',
  UNWATCH_ROOMS: 'blackjack:unwatch_rooms',
  SET_VISIBILITY: 'blackjack:set_visibility',
  /** Host only, lobby only: how much each player bets in the Arena. */
  SET_STAKE: 'blackjack:set_stake',
  SET_RULES: 'blackjack:set_rules',
  JOIN: 'blackjack:join',
  SYNC: 'blackjack:sync',
  LEAVE: 'blackjack:leave',
  READY: 'blackjack:ready',
  START: 'blackjack:start',
  REMATCH: 'blackjack:rematch',
  BET: 'blackjack:bet',
  INSURANCE: 'blackjack:insurance',
  ACT: 'blackjack:act',
  EMOTE: 'blackjack:emote',
} as const;

export const BjServerEvents = {
  STATE: 'blackjack:state',
  ROOMS_UPDATED: 'blackjack:rooms_updated',
  ROOM_CLOSED: 'blackjack:room_closed',
  EMOTED: 'blackjack:emoted',
  PLAYER_JOINED: 'blackjack:player_joined',
  PLAYER_LEFT: 'blackjack:player_left',
  PLAYER_DISCONNECTED: 'blackjack:player_disconnected',
  PLAYER_RECONNECTED: 'blackjack:player_reconnected',
  MATCH_STARTED: 'blackjack:match_started',
  ROUND_STARTED: 'blackjack:round_started',
  SHUFFLED: 'blackjack:shuffled',
  DEALT: 'blackjack:dealt',
  ACTED: 'blackjack:acted',
  DEALER_PLAYED: 'blackjack:dealer_played',
  ROUND_SETTLED: 'blackjack:round_settled',
  PLAYER_BROKE: 'blackjack:player_broke',
  MATCH_OVER: 'blackjack:match_over',
} as const;

const actionIdSchema = z.string().min(8).max(64);

export const bjEmptySchema = z.object({}).strict();
export const bjCreateSchema = z
  .object({ isPublic: z.boolean().default(true) })
  .strict();
export const bjVisibilitySchema = z.object({ isPublic: z.boolean() });
export const bjSetRulesSchema = z.object({ rules: bjRulesSchema });
export const bjJoinSchema = z.object({ code: roomCodeSchema });
export const bjReadySchema = z.object({ ready: z.boolean() });
export const bjBetSchema = z.object({
  actionId: actionIdSchema,
  amount: z
    .number()
    .int()
    .min(BJ_MIN_BET)
    .max(BJ_MAX_BET)
    .refine((n) => n % BJ_BET_STEP === 0),
});
export const bjInsuranceSchema = z.object({
  actionId: actionIdSchema,
  take: z.boolean(),
});
export const bjActSchema = z.object({
  actionId: actionIdSchema,
  action: z.enum(['hit', 'stand', 'double', 'split', 'surrender']),
});
export const bjEmoteSchema = z.object({ emote: z.enum(BJ_EMOTES) });

export type BjLeftReason = 'left' | 'expired';

/** Every announcement carries a room-wide sequence number so clients can drop duplicates. */
export interface BjServerEventPayloads {
  'blackjack:state': BjRoomState;
  'blackjack:rooms_updated': { rooms: BjPublicRoom[] };
  'blackjack:room_closed': { reason: 'empty' };
  'blackjack:emoted': { seat: number; emote: BjEmote };
  'blackjack:player_joined': { seq: number; player: BjSeatPlayer };
  'blackjack:player_left': {
    seq: number;
    seat: number;
    userId: string;
    reason: BjLeftReason;
  };
  'blackjack:player_disconnected': {
    seq: number;
    seat: number;
    reconnectDeadline: number;
  };
  'blackjack:player_reconnected': { seq: number; seat: number };
  'blackjack:match_started': { seq: number; rounds: number };
  'blackjack:round_started': { seq: number; round: number };
  'blackjack:shuffled': { seq: number };
  /** Cartas iniciais na mesa; `insurance` = o dealer mostra um Ás; `blackjacks` = lugares com 21 natural. */
  'blackjack:dealt': { seq: number; insurance: boolean; blackjacks: number[] };
  'blackjack:acted': {
    seq: number;
    seat: number;
    hand: number;
    action: BjAction;
    /** O que a mão virou depois da jogada. */
    status: BjHandStatus;
    total: number;
    /** O tempo acabou e o servidor parou a mão. */
    auto: boolean;
  };
  'blackjack:dealer_played': {
    seq: number;
    total: number;
    blackjack: boolean;
    bust: boolean;
    /** Cartas que o dealer comprou depois de virar a escondida. */
    drew: number;
  };
  'blackjack:round_settled': {
    seq: number;
    round: number;
    nets: { seat: number; net: number }[];
  };
  'blackjack:player_broke': { seq: number; seat: number };
  'blackjack:match_over': { seq: number } & BjMatchResult;
}
export type BjServerEventName = keyof BjServerEventPayloads;

export interface BjClientAckData {
  'blackjack:create': BjSnapshot;
  'blackjack:watch_rooms': BjPublicRoom[];
  'blackjack:unwatch_rooms': null;
  'blackjack:set_visibility': null;
  'blackjack:set_stake': null;
  'blackjack:set_rules': null;
  'blackjack:join': BjSnapshot;
  'blackjack:sync': BjSnapshot;
  'blackjack:leave': null;
  'blackjack:ready': null;
  'blackjack:start': null;
  'blackjack:rematch': null;
  'blackjack:bet': null;
  'blackjack:insurance': null;
  'blackjack:act': null;
  'blackjack:emote': null;
}

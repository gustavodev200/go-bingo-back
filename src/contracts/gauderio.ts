import { z } from 'zod';
import { roomCodeSchema } from './room';

// ---------------------------------------------------------------------------
// Truco Gaudério / Argentino: baralho espanhol, 2 ou 4 jogadores, Envido e Flor.
// ---------------------------------------------------------------------------

/** Naipes do baralho espanhol. */
export const GAUD_SUITS = ['espadas', 'paus', 'copas', 'ouros'] as const;
export type GaudSuit = (typeof GAUD_SUITS)[number];

/** 40 cartas: sem 8, 9 e coringas. 10 = Sota (valete), 11 = Cavalo, 12 = Rei. */
export const GAUD_RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12] as const;
export type GaudRank = (typeof GAUD_RANKS)[number];

export interface GaudCard {
  rank: GaudRank;
  suit: GaudSuit;
}

/** Manilhas, da maior para a menor. */
export const GAUD_MANILHAS = [
  { rank: 1, suit: 'espadas', name: 'Espadão' },
  { rank: 1, suit: 'paus', name: 'Bastião' },
  { rank: 7, suit: 'espadas', name: 'Sete de espadas' },
  { rank: 7, suit: 'ouros', name: 'Sete de ouros' },
] as const satisfies readonly (GaudCard & { name: string })[];

/** Cartas comuns, mais fracas primeiro: 4 < 5 < 6 < 7 < 10 < 11 < 12 < 1 < 2 < 3. */
const COMMON_STRENGTH: Record<GaudRank, number> = {
  4: 1,
  5: 2,
  6: 3,
  7: 4,
  10: 5,
  11: 6,
  12: 7,
  1: 8,
  2: 9,
  3: 10,
};

/**
 * Força comparável de uma carta no truco: 1 de espadas (14) > 1 de paus (13) >
 * 7 de espadas (12) > 7 de ouros (11) > 3 > 2 > 1 (copas/ouros) > 12 > 11 > 10 >
 * 7 (paus/copas) > 6 > 5 > 4. Cartas comuns iguais empatam, qualquer que seja o naipe.
 */
export function gaudStrength(card: GaudCard): number {
  const manilha = GAUD_MANILHAS.findIndex(
    (m) => m.rank === card.rank && m.suit === card.suit,
  );
  if (manilha >= 0) return 14 - manilha;
  return COMMON_STRENGTH[card.rank];
}

export function gaudManilhaName(card: GaudCard): string | null {
  return (
    GAUD_MANILHAS.find((m) => m.rank === card.rank && m.suit === card.suit)
      ?.name ?? null
  );
}

/** Valor da carta no envido: 1 a 7 valem o número, figuras (10, 11, 12) valem zero. */
export const envidoValue = (card: GaudCard): number =>
  card.rank <= 7 ? card.rank : 0;

/**
 * Pontos de envido de uma mão de 3 cartas: duas do mesmo naipe valem 20 + a soma
 * delas (a melhor dupla); sem naipe repetido vale a carta mais alta.
 */
export function envidoPoints(cards: readonly GaudCard[]): number {
  let best = Math.max(0, ...cards.map(envidoValue));
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++)
      if (cards[i].suit === cards[j].suit)
        best = Math.max(
          best,
          20 + envidoValue(cards[i]) + envidoValue(cards[j]),
        );
  return best;
}

/** Flor: as três cartas do mesmo naipe. */
export const hasFlor = (cards: readonly GaudCard[]): boolean =>
  cards.length === 3 && cards.every((c) => c.suit === cards[0].suit);

/** Pontos da flor: 20 + a soma das três cartas. */
export const florPoints = (cards: readonly GaudCard[]): number =>
  20 + cards.reduce((sum, c) => sum + envidoValue(c), 0);

// ---------------------------------------------------------------------------
// Regras / configuração da mesa
// ---------------------------------------------------------------------------

export const GAUD_MAX_SEATS = 4;
export const GAUD_SIZES = [2, 4] as const;
export type GaudSize = (typeof GAUD_SIZES)[number];
export const GAUD_TARGETS = [12, 24] as const;
export type GaudTarget = (typeof GAUD_TARGETS)[number];

export interface GaudSettings {
  /** 2 = mano a mano; 4 = duplas (parceiros frente a frente). */
  size: GaudSize;
  /** Pontos para ganhar a partida. */
  target: GaudTarget;
  /** Jogar com flor (três cartas do mesmo naipe). */
  flor: boolean;
}

export const GAUD_DEFAULT_SETTINGS: GaudSettings = {
  size: 2,
  target: 12,
  flor: true,
};

export type GaudSeat = 0 | 1 | 2 | 3;
/** Time 0 = lugares 0 e 2; time 1 = lugares 1 e 3. Mano a mano: lugar 0 contra lugar 1. */
export type GaudTeam = 0 | 1;
export const gaudTeamOf = (seat: number): GaudTeam => (seat % 2) as GaudTeam;

/** Todos os cantos: truco, envido e flor. */
export const GAUD_CALLS = [
  'truco',
  'retruco',
  'vale4',
  'envido',
  'real_envido',
  'falta_envido',
  'flor',
  'contraflor',
  'contraflor_resto',
] as const;
export type GaudCall = (typeof GAUD_CALLS)[number];

export const GAUD_CALL_LABEL: Record<GaudCall, string> = {
  truco: 'Truco',
  retruco: 'Retruco',
  vale4: 'Vale 4',
  envido: 'Envido',
  real_envido: 'Real Envido',
  falta_envido: 'Falta Envido',
  flor: 'Flor',
  contraflor: 'Contra-flor',
  contraflor_resto: 'Contra-flor e o resto',
};

export type GaudCallKind = 'truco' | 'envido' | 'flor';
export const gaudCallKind = (call: GaudCall): GaudCallKind =>
  call === 'truco' || call === 'retruco' || call === 'vale4'
    ? 'truco'
    : call === 'flor' || call === 'contraflor' || call === 'contraflor_resto'
      ? 'flor'
      : 'envido';

/** Truco: valor da mão depois de cada pedido aceito. */
export const GAUD_TRUCO_VALUE: Record<'truco' | 'retruco' | 'vale4', number> = {
  truco: 2,
  retruco: 3,
  vale4: 4,
};

/** Envido: o que cada canto soma quando aceito (falta envido vale a falta). */
export const GAUD_ENVIDO_VALUE = { envido: 2, real_envido: 3 } as const;
/** Flor sem flor do outro lado. */
export const GAUD_FLOR_POINTS = 3;
/** Contra-flor aceita. */
export const GAUD_CONTRAFLOR_POINTS = 6;
/** Quem foge da flor (ou da contra-flor) entrega isto. */
export const GAUD_FLOR_DECLINED_POINTS = 4;

/** Falta: o que falta a quem está ganhando para fechar a partida. */
export const faltaPoints = (
  scores: readonly [number, number],
  target: number,
) => Math.max(1, target - Math.max(scores[0], scores[1]));

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

export const GAUD_ROOM_PHASES = ['LOBBY', 'PLAYING', 'FINISHED'] as const;
export type GaudRoomPhase = (typeof GAUD_ROOM_PHASES)[number];
export type GaudLobbyStatus = 'WAITING_PLAYERS' | 'READY_TO_START';

export const GAUD_HAND_PHASES = [
  'AWAITING_PLAY',
  'AWAITING_RESPONSE',
  'HAND_OVER',
] as const;
export type GaudHandPhase = (typeof GAUD_HAND_PHASES)[number];

export type GaudHandEndReason = 'rounds' | 'declined' | 'folded';
export type GaudMatchEndReason = 'points' | 'abandoned';

export interface GaudSeatPlayer {
  seat: GaudSeat;
  team: GaudTeam;
  userId: string;
  nickname: string;
  character: string | null;
  /** CPU chamada pelo anfitrião (id sintético `cpu:N`). */
  bot: boolean;
  ready: boolean;
  connected: boolean;
  /** Epoch ms em que o lugar reservado é liberado; null enquanto conectado. */
  reconnectDeadline: number | null;
}

/** Carta na mesa; `card` é null quando foi jogada escondida. */
export interface GaudPlay {
  seat: GaudSeat;
  card: GaudCard | null;
  hidden: boolean;
}

export interface GaudRoundView {
  plays: GaudPlay[];
  result: GaudTeam | 'tie' | null;
  winningSeat: GaudSeat | null;
}

/** Um canto esperando resposta da outra dupla. */
export interface GaudPending {
  kind: GaudCallKind;
  /** Último canto da sequência (ex.: envido → real_envido). */
  call: GaudCall;
  /** Sequência inteira desta disputa. */
  chain: GaudCall[];
  seat: GaudSeat;
  team: GaudTeam;
}

/** Resultado de uma disputa de envido ou flor. */
export interface GaudSideResult {
  kind: 'envido' | 'flor';
  winnerTeam: GaudTeam;
  points: number;
  /** false = fugiram (ninguém mostrou os pontos). */
  accepted: boolean;
  /** Melhores pontos de cada dupla quando houve comparação. */
  teamPoints: [number | null, number | null];
  /** Quem tinha os melhores pontos de cada dupla. */
  bestSeats: [GaudSeat | null, GaudSeat | null];
}

export interface GaudHandResult {
  winnerTeam: GaudTeam;
  points: number;
  reason: GaudHandEndReason;
}

export interface GaudMatchView {
  handNumber: number;
  dealer: GaudSeat;
  /** Quem começa a mão (desempata envido, flor e três rodadas empatadas). */
  mano: GaudSeat;
  phase: GaudHandPhase;
  turn: GaudSeat;
  /** Valor atual da mão no truco (1 a 4). */
  trucoValue: number;
  /** Dupla que fez o último pedido de truco aceito (não pode aumentar de novo). */
  trucoLastRaiseTeam: GaudTeam | null;
  pending: GaudPending | null;
  /** Um truco ficou esperando porque responderam com envido/flor. */
  trucoOnHold: boolean;
  /** Envido/flor já disputados ou fora de hora nesta mão. */
  envidoClosed: boolean;
  sideResults: GaudSideResult[];
  rounds: GaudRoundView[];
  cardsLeft: number[];
  lastHandResult: GaudHandResult | null;
}

export interface GaudMatchResult {
  winnerTeam: GaudTeam;
  reason: GaudMatchEndReason;
  scores: [number, number];
}

export interface GaudRoomState {
  code: string;
  version: number;
  hostId: string;
  isPublic: boolean;
  /** Aposta de cada jogador nesta mesa (Arena). */
  stake: number;
  settings: GaudSettings;
  phase: GaudRoomPhase;
  lobbyStatus: GaudLobbyStatus | null;
  /** Sempre 4 posições; só as `settings.size` primeiras são usadas. */
  seats: (GaudSeatPlayer | null)[];
  scores: [number, number];
  match: GaudMatchView | null;
  result: GaudMatchResult | null;
}

export interface GaudHandCard {
  id: string;
  card: GaudCard;
}

/** O que o jogador pode fazer agora (calculado pelo servidor). */
export interface GaudActions {
  canPlay: boolean;
  /** Pode jogar carta escondida (da 2ª rodada em diante). */
  canHide: boolean;
  /** Pode ir ao baralho. */
  canFold: boolean;
  /** Cantos disponíveis (inclui os aumentos quando responde). */
  calls: GaudCall[];
  /** Pode aceitar (quiero) / fugir (não quero) o canto pendente. */
  canAccept: boolean;
  canDecline: boolean;
}

/** Estado privado: só vai para o dono. */
export interface GaudPrivateHand {
  handNumber: number;
  cards: GaudHandCard[];
  /** Pontos de envido das 3 cartas recebidas. */
  envido: number;
  /** Tem flor (só com a regra ligada). */
  flor: boolean;
  actions: GaudActions;
}

export interface GaudPublicRoom {
  code: string;
  hostNickname: string;
  hostCharacter: string | null;
  stake: number;
  players: number;
  settings: GaudSettings;
}

export const GAUD_PUBLIC_ROOMS_CHANNEL = 'gauderio-public-rooms';

export interface GaudSnapshot {
  state: GaudRoomState;
  mySeat: GaudSeat;
  hand: GaudPrivateHand | null;
}

// ---------------------------------------------------------------------------
// Socket.IO (namespace /gauderio)
// ---------------------------------------------------------------------------

export const GAUD_NAMESPACE = '/gauderio';

export const GaudClientEvents = {
  CREATE: 'gauderio:create',
  WATCH_ROOMS: 'gauderio:watch_rooms',
  UNWATCH_ROOMS: 'gauderio:unwatch_rooms',
  SET_VISIBILITY: 'gauderio:set_visibility',
  SET_STAKE: 'gauderio:set_stake',
  SET_SETTINGS: 'gauderio:set_settings',
  JOIN: 'gauderio:join',
  LEAVE: 'gauderio:leave',
  TAKE_SEAT: 'gauderio:take_seat',
  READY: 'gauderio:ready',
  /** Host only, lobby only: a CPU takes the first free seat. */
  ADD_BOT: 'gauderio:add_bot',
  REMOVE_BOT: 'gauderio:remove_bot',
  START: 'gauderio:start',
  PLAY_CARD: 'gauderio:play_card',
  CALL: 'gauderio:call',
  RESPOND: 'gauderio:respond',
  FOLD: 'gauderio:fold',
  SYNC: 'gauderio:sync',
  REMATCH: 'gauderio:rematch',
} as const;

export const GaudServerEvents = {
  STATE: 'gauderio:state',
  PRIVATE_HAND: 'gauderio:private_hand',
  PLAYER_JOINED: 'gauderio:player_joined',
  PLAYER_LEFT: 'gauderio:player_left',
  PLAYER_DISCONNECTED: 'gauderio:player_disconnected',
  PLAYER_RECONNECTED: 'gauderio:player_reconnected',
  MATCH_STARTED: 'gauderio:match_started',
  HAND_DEALT: 'gauderio:hand_dealt',
  CARD_PLAYED: 'gauderio:card_played',
  ROUND_ENDED: 'gauderio:round_ended',
  CALLED: 'gauderio:called',
  RESPONDED: 'gauderio:responded',
  SIDE_RESOLVED: 'gauderio:side_resolved',
  FOLDED: 'gauderio:folded',
  HAND_ENDED: 'gauderio:hand_ended',
  SCORE_UPDATED: 'gauderio:score_updated',
  MATCH_OVER: 'gauderio:match_over',
  ROOM_CLOSED: 'gauderio:room_closed',
  ROOMS_UPDATED: 'gauderio:rooms_updated',
} as const;

const actionIdSchema = z.string().min(8).max(64);

export const gaudSettingsSchema = z
  .object({
    size: z.union([z.literal(2), z.literal(4)]),
    target: z.union([z.literal(12), z.literal(24)]),
    flor: z.boolean(),
  })
  .strict();

export const gaudEmptySchema = z.object({}).strict();
export const gaudCreateSchema = z
  .object({
    isPublic: z.boolean().default(true),
    settings: gaudSettingsSchema.default(GAUD_DEFAULT_SETTINGS),
  })
  .strict();
export const gaudVisibilitySchema = z.object({ isPublic: z.boolean() });
export const gaudSetSettingsSchema = z.object({
  settings: gaudSettingsSchema,
});
export const gaudJoinSchema = z.object({ code: roomCodeSchema });
export const gaudTakeSeatSchema = z.object({
  seat: z.number().int().min(0).max(3),
});
export const gaudReadySchema = z.object({ ready: z.boolean() });
export const gaudRemoveBotSchema = z.object({
  seat: z
    .number()
    .int()
    .min(0)
    .max(GAUD_MAX_SEATS - 1),
});
export const gaudPlayCardSchema = z.object({
  actionId: actionIdSchema,
  cardId: z.string().min(1).max(32),
  hidden: z.boolean().default(false),
});
export const gaudCallSchema = z.object({
  actionId: actionIdSchema,
  call: z.enum(GAUD_CALLS),
});
export const gaudRespondSchema = z.object({
  actionId: actionIdSchema,
  accept: z.boolean(),
});
export const gaudFoldSchema = z.object({ actionId: actionIdSchema });

export type GaudLeftReason = 'left' | 'expired' | 'removed';

export interface GaudServerEventPayloads {
  'gauderio:state': GaudRoomState;
  'gauderio:private_hand': GaudPrivateHand;
  'gauderio:player_joined': { seq: number; player: GaudSeatPlayer };
  'gauderio:player_left': {
    seq: number;
    seat: GaudSeat;
    userId: string;
    reason: GaudLeftReason;
  };
  'gauderio:player_disconnected': {
    seq: number;
    seat: GaudSeat;
    reconnectDeadline: number;
  };
  'gauderio:player_reconnected': { seq: number; seat: GaudSeat };
  'gauderio:match_started': { seq: number };
  'gauderio:hand_dealt': { seq: number; handNumber: number; mano: GaudSeat };
  'gauderio:card_played': {
    seq: number;
    seat: GaudSeat;
    card: GaudCard | null;
    hidden: boolean;
    round: number;
  };
  'gauderio:round_ended': {
    seq: number;
    round: number;
    result: GaudTeam | 'tie';
    winningSeat: GaudSeat;
  };
  'gauderio:called': {
    seq: number;
    seat: GaudSeat;
    team: GaudTeam;
    call: GaudCall;
  };
  'gauderio:responded': {
    seq: number;
    seat: GaudSeat;
    accept: boolean;
    call: GaudCall;
  };
  'gauderio:side_resolved': { seq: number } & GaudSideResult;
  'gauderio:folded': { seq: number; seat: GaudSeat; team: GaudTeam };
  'gauderio:hand_ended': { seq: number } & GaudHandResult;
  'gauderio:score_updated': { seq: number; scores: [number, number] };
  'gauderio:match_over': { seq: number } & GaudMatchResult;
  'gauderio:room_closed': { reason: 'empty' };
  'gauderio:rooms_updated': { rooms: GaudPublicRoom[] };
}
export type GaudServerEventName = keyof GaudServerEventPayloads;

export interface GaudClientAckData {
  'gauderio:create': GaudSnapshot;
  'gauderio:watch_rooms': GaudPublicRoom[];
  'gauderio:unwatch_rooms': null;
  'gauderio:set_visibility': null;
  'gauderio:set_stake': null;
  'gauderio:set_settings': null;
  'gauderio:join': GaudSnapshot;
  'gauderio:leave': null;
  'gauderio:take_seat': null;
  'gauderio:ready': null;
  'gauderio:add_bot': null;
  'gauderio:remove_bot': null;
  'gauderio:start': null;
  'gauderio:play_card': null;
  'gauderio:call': null;
  'gauderio:respond': null;
  'gauderio:fold': null;
  'gauderio:sync': GaudSnapshot;
  'gauderio:rematch': null;
}

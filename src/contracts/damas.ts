import { z } from 'zod';
import { roomCodeSchema } from './room';

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

/**
 * Damas brasileiras: 8x8, 12 pedras de cada lado, só nas casas escuras.
 *
 * Casa = linha * 8 + coluna. A linha 0 é o fundo das pretas (topo para quem
 * joga de brancas) e a linha 7 o fundo das brancas. A casa escura do canto
 * inferior esquerdo (linha 7, coluna 0) fica à esquerda de cada jogador.
 */
export const DAMAS_SIZE = 8;
export const DAMAS_SQUARES = DAMAS_SIZE * DAMAS_SIZE;
export const DAMAS_SEATS = 2;
export const DAMAS_PIECES = 12;
/** Empate: tantos lances seguidos de cada lado só com damas, sem captura nem pedra andando. */
export const DAMAS_DRAW_MOVES = 20;
/** Quem deixar o tempo acabar tantas vezes seguidas perde a partida. */
export const DAMAS_MAX_TIMEOUTS = 3;

export const DAMAS_COLORS = ['white', 'black'] as const;
export type DamasColor = (typeof DAMAS_COLORS)[number];

/** Uma casa no tabuleiro público: vazia, pedra (minúscula) ou dama (maiúscula). */
export type DamasCell = '.' | 'w' | 'W' | 'b' | 'B';

export const damasRow = (square: number) => Math.floor(square / DAMAS_SIZE);
export const damasCol = (square: number) => square % DAMAS_SIZE;
export const damasSquare = (row: number, col: number) => row * DAMAS_SIZE + col;
export const isDarkSquare = (square: number) =>
  (damasRow(square) + damasCol(square)) % 2 === 1;

/** Tabuleiro inicial: pretas nas linhas 0–2, brancas nas linhas 5–7 (64 caracteres). */
export const DAMAS_INITIAL_BOARD: string = Array.from(
  { length: DAMAS_SQUARES },
  (_, sq) => {
    if (!isDarkSquare(sq)) return '.';
    const row = damasRow(sq);
    if (row <= 2) return 'b';
    if (row >= 5) return 'w';
    return '.';
  },
).join('');

/** Nome da casa como no tabuleiro oficial (a1 = canto inferior esquerdo das brancas). */
export const damasSquareName = (square: number) =>
  `${'abcdefgh'[damasCol(square)]}${DAMAS_SIZE - damasRow(square)}`;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const DAMAS_TURN_SECONDS = [30, 60, 120] as const;
export type DamasTurnSeconds = (typeof DAMAS_TURN_SECONDS)[number];

export const damasRulesSchema = z
  .object({
    /** Tempo de cada lance; acabou, o servidor joga um lance válido por você. */
    turnSeconds: z.union([z.literal(30), z.literal(60), z.literal(120)]),
  })
  .strict();
export type DamasRules = z.infer<typeof damasRulesSchema>;

export const DEFAULT_DAMAS_RULES: DamasRules = { turnSeconds: 60 };

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export const DAMAS_ROOM_PHASES = ['LOBBY', 'PLAYING', 'FINISHED'] as const;
export type DamasRoomPhase = (typeof DAMAS_ROOM_PHASES)[number];
export type DamasLobbyStatus = 'WAITING_PLAYERS' | 'READY_TO_START';

export type DamasEndReason =
  /** O adversário ficou sem peças. */
  | 'no_pieces'
  /** O adversário não tinha lance possível. */
  | 'blocked'
  | 'resign'
  /** O adversário estourou o tempo {DAMAS_MAX_TIMEOUTS} vezes seguidas. */
  | 'timeout'
  | 'abandoned'
  | 'draw_agreed'
  /** {DAMAS_DRAW_MOVES} lances de cada lado só com damas, sem captura. */
  | 'draw_moves';

export interface DamasSeatPlayer {
  seat: number;
  userId: string;
  nickname: string;
  character: string | null;
  ready: boolean;
  connected: boolean;
  /** Epoch ms when the reserved seat is released; null while connected. */
  reconnectDeadline: number | null;
}

/** Um lance completo: casa de saída, casas onde a peça pousa (uma por salto) e peças capturadas. */
export interface DamasMove {
  from: number;
  path: number[];
  captures: number[];
}

export interface DamasLastMove extends DamasMove {
  seat: number;
  promoted: boolean;
}

export interface DamasGameView {
  /** 64 casas (`DamasCell`), linha 0 primeiro. */
  board: string;
  /** Quem joga agora. */
  turn: DamasColor;
  /** Lances válidos de quem joga agora (captura obrigatória e lei da maioria já aplicadas). */
  moves: DamasMove[];
  lastMove: DamasLastMove | null;
  /** Lances seguidos só com damas e sem captura (empata em 2 × DAMAS_DRAW_MOVES). */
  quietMoves: number;
  /** Lances jogados na partida (os dois lados). */
  plies: number;
  /** Lugar que propôs empate e espera resposta; null se nenhum. */
  drawOffer: number | null;
  /** Tempos estourados seguidos de cada lugar. */
  timeouts: number[];
  /** Epoch ms when the turn times out; null when the match is over. */
  turnDeadline: number | null;
}

export interface DamasMatchResult {
  /** Lugar vencedor; null = empate. */
  winner: number | null;
  reason: DamasEndReason;
}

/** Public table state: identical for everybody (damas has no hidden information). */
export interface DamasRoomState {
  code: string;
  version: number;
  hostId: string;
  isPublic: boolean;
  /** Aposta de cada jogador nesta mesa (Arena). */
  stake: number;
  rules: DamasRules;
  phase: DamasRoomPhase;
  lobbyStatus: DamasLobbyStatus | null;
  seats: (DamasSeatPlayer | null)[];
  /** Lugar que joga de brancas (sai primeiro) na partida atual ou na próxima. */
  whiteSeat: number;
  game: DamasGameView | null;
  result: DamasMatchResult | null;
}

export const damasColorOf = (
  state: Pick<DamasRoomState, 'whiteSeat'>,
  seat: number,
): DamasColor => (seat === state.whiteSeat ? 'white' : 'black');

export interface DamasPublicRoom {
  code: string;
  hostNickname: string;
  hostCharacter: string | null;
  stake: number;
  players: number;
  rules: DamasRules;
}

export const DAMAS_PUBLIC_ROOMS_CHANNEL = 'damas-public-rooms';

export interface DamasSnapshot {
  state: DamasRoomState;
  mySeat: number;
}

export const DAMAS_EMOTES = [
  'laugh',
  'shock',
  'angry',
  'clap',
  'fire',
  'pray',
] as const;
export type DamasEmote = (typeof DAMAS_EMOTES)[number];

// ---------------------------------------------------------------------------
// Socket.IO events (namespace /damas)
// ---------------------------------------------------------------------------

export const DAMAS_NAMESPACE = '/damas';

export const DamasClientEvents = {
  CREATE: 'damas:create',
  WATCH_ROOMS: 'damas:watch_rooms',
  UNWATCH_ROOMS: 'damas:unwatch_rooms',
  SET_VISIBILITY: 'damas:set_visibility',
  /** Host only, lobby only: how much each player bets. */
  SET_STAKE: 'damas:set_stake',
  SET_RULES: 'damas:set_rules',
  JOIN: 'damas:join',
  SYNC: 'damas:sync',
  LEAVE: 'damas:leave',
  READY: 'damas:ready',
  START: 'damas:start',
  REMATCH: 'damas:rematch',
  MOVE: 'damas:move',
  RESIGN: 'damas:resign',
  OFFER_DRAW: 'damas:offer_draw',
  ANSWER_DRAW: 'damas:answer_draw',
  EMOTE: 'damas:emote',
} as const;

export const DamasServerEvents = {
  STATE: 'damas:state',
  ROOMS_UPDATED: 'damas:rooms_updated',
  ROOM_CLOSED: 'damas:room_closed',
  EMOTED: 'damas:emoted',
  PLAYER_JOINED: 'damas:player_joined',
  PLAYER_LEFT: 'damas:player_left',
  PLAYER_DISCONNECTED: 'damas:player_disconnected',
  PLAYER_RECONNECTED: 'damas:player_reconnected',
  MATCH_STARTED: 'damas:match_started',
  MOVED: 'damas:moved',
  TURN_TIMED_OUT: 'damas:turn_timed_out',
  DRAW_OFFERED: 'damas:draw_offered',
  DRAW_DECLINED: 'damas:draw_declined',
  MATCH_OVER: 'damas:match_over',
} as const;

const actionIdSchema = z.string().min(8).max(64);
const squareSchema = z
  .number()
  .int()
  .min(0)
  .max(DAMAS_SQUARES - 1);

export const damasEmptySchema = z.object({}).strict();
export const damasCreateSchema = z
  .object({ isPublic: z.boolean().default(true) })
  .strict();
export const damasVisibilitySchema = z.object({ isPublic: z.boolean() });
export const damasSetRulesSchema = z.object({ rules: damasRulesSchema });
export const damasJoinSchema = z.object({ code: roomCodeSchema });
export const damasReadySchema = z.object({ ready: z.boolean() });
export const damasActionSchema = z.object({ actionId: actionIdSchema });
export const damasMoveSchema = z.object({
  actionId: actionIdSchema,
  from: squareSchema,
  /** Casas onde a peça pousa, em ordem (12 = mais capturas possíveis num lance). */
  path: z.array(squareSchema).min(1).max(12),
});
export const damasAnswerDrawSchema = z.object({
  actionId: actionIdSchema,
  accept: z.boolean(),
});
export const damasEmoteSchema = z.object({ emote: z.enum(DAMAS_EMOTES) });

export type DamasLeftReason = 'left' | 'expired';

/** Every announcement carries a room-wide sequence number so clients can drop duplicates. */
export interface DamasServerEventPayloads {
  'damas:state': DamasRoomState;
  'damas:rooms_updated': { rooms: DamasPublicRoom[] };
  'damas:room_closed': { reason: 'empty' };
  'damas:emoted': { seat: number; emote: DamasEmote };
  'damas:player_joined': { seq: number; player: DamasSeatPlayer };
  'damas:player_left': {
    seq: number;
    seat: number;
    userId: string;
    reason: DamasLeftReason;
  };
  'damas:player_disconnected': {
    seq: number;
    seat: number;
    reconnectDeadline: number;
  };
  'damas:player_reconnected': { seq: number; seat: number };
  'damas:match_started': { seq: number; whiteSeat: number };
  'damas:moved': { seq: number } & DamasLastMove;
  'damas:turn_timed_out': { seq: number; seat: number };
  'damas:draw_offered': { seq: number; seat: number };
  'damas:draw_declined': { seq: number; seat: number };
  'damas:match_over': { seq: number } & DamasMatchResult;
}
export type DamasServerEventName = keyof DamasServerEventPayloads;

export interface DamasClientAckData {
  'damas:create': DamasSnapshot;
  'damas:watch_rooms': DamasPublicRoom[];
  'damas:unwatch_rooms': null;
  'damas:set_visibility': null;
  'damas:set_stake': null;
  'damas:set_rules': null;
  'damas:join': DamasSnapshot;
  'damas:sync': DamasSnapshot;
  'damas:leave': null;
  'damas:ready': null;
  'damas:start': null;
  'damas:rematch': null;
  'damas:move': null;
  'damas:resign': null;
  'damas:offer_draw': null;
  'damas:answer_draw': null;
  'damas:emote': null;
}

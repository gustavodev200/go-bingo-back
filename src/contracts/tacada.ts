import { z } from 'zod';
import { roomCodeSchema } from './room';
import type { TacadaBallPos, TacadaShot } from './tacada-physics';

// ---------------------------------------------------------------------------
// Tacada: bilhar bola 8, 1 contra 1
// ---------------------------------------------------------------------------

export const TACADA_SEATS = 2;
/** Três faltas seguidas do mesmo jogador = derrota (regra da casa). */
export const TACADA_MAX_FOULS = 3;
/** Tolerância entre o fim da animação calculado pelo servidor e o cliente liberar a próxima tacada. */
export const TACADA_READY_SLACK_MS = 400;

export type TacadaGroup = 'solids' | 'stripes';

export const TACADA_SHOT_SECONDS = [20, 30, 45] as const;
export type TacadaShotSeconds = (typeof TACADA_SHOT_SECONDS)[number];

export const TACADA_AIM_GUIDES = ['long', 'short'] as const;
export type TacadaAimGuide = (typeof TACADA_AIM_GUIDES)[number];

export const tacadaRulesSchema = z
  .object({
    /** Tempo de cada tacada; acabou, é falta (bola na mão para o adversário). */
    shotSeconds: z.union([z.literal(20), z.literal(30), z.literal(45)]),
    /** Mira longa (mostra o caminho da bola atingida) ou curta (só a bola fantasma). */
    aimGuide: z.enum(TACADA_AIM_GUIDES),
  })
  .strict();
export type TacadaRules = z.infer<typeof tacadaRulesSchema>;

export const DEFAULT_TACADA_RULES: TacadaRules = {
  shotSeconds: 30,
  aimGuide: 'long',
};

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export const TACADA_ROOM_PHASES = ['LOBBY', 'PLAYING', 'FINISHED'] as const;
export type TacadaRoomPhase = (typeof TACADA_ROOM_PHASES)[number];
export type TacadaLobbyStatus = 'WAITING_PLAYERS' | 'READY_TO_START';

export type TacadaFoul =
  /** A branca caiu na caçapa. */
  | 'scratch'
  /** A branca não tocou bola nenhuma. */
  | 'no_hit'
  /** A primeira bola tocada não era do seu grupo (ou era a 8 antes da hora). */
  | 'wrong_first'
  /** Depois do toque, nenhuma bola foi para a tabela nem caiu. */
  | 'no_rail'
  /** O tempo da tacada acabou. */
  | 'timeout';

export type TacadaEndReason =
  /** Encaçapou a 8 na caçapa cantada, com o grupo já limpo. */
  | 'eight'
  /** O adversário encaçapou a 8 antes de limpar o grupo. */
  | 'eight_early'
  /** O adversário encaçapou a 8 junto com uma falta (ex.: branca caiu). */
  | 'eight_foul'
  /** O adversário encaçapou a 8 em outra caçapa, não na cantada. */
  | 'eight_wrong_pocket'
  /** O adversário fez {TACADA_MAX_FOULS} faltas seguidas. */
  | 'fouls'
  | 'resign'
  | 'abandoned';

export interface TacadaSeatPlayer {
  seat: number;
  userId: string;
  nickname: string;
  character: string | null;
  /** CPU chamada pelo anfitrião (id sintético `cpu:N`). */
  bot: boolean;
  ready: boolean;
  connected: boolean;
  /** Epoch ms when the reserved seat is released; null while connected. */
  reconnectDeadline: number | null;
}

/** A tacada como o servidor executou (o cliente reproduz a mesma simulação). */
export interface TacadaShotRecord extends TacadaShot {
  seat: number;
  /** Posições antes da tacada (já com a branca onde foi colocada). */
  start: TacadaBallPos[];
}

export interface TacadaLastShot {
  seat: number;
  /** Número da tacada na partida (1, 2, …); muda a cada tacada. */
  number: number;
  pocketed: number[];
  foul: TacadaFoul | null;
  /** A 8 caiu na saída e voltou para a mesa. */
  eightRespotted: boolean;
  /** Quem joga continua na mesa. */
  keepsTurn: boolean;
}

export interface TacadaGameView {
  /** 16 posições (índice = número da bola, 0 = branca); null = encaçapada. */
  balls: TacadaBallPos[];
  /** Lugar que joga agora. */
  turn: number;
  /** Grupo de cada lugar; null = mesa aberta. */
  groups: (TacadaGroup | null)[];
  /** Quem joga pode colocar a branca onde quiser (na saída, só atrás da linha). */
  ballInHand: boolean;
  /** Próxima tacada é a saída. */
  breakShot: boolean;
  /** Quem joga já limpou o grupo: vai na 8 e precisa cantar a caçapa. */
  onEight: boolean;
  /** Faltas seguidas de cada lugar. */
  fouls: number[];
  lastShot: TacadaLastShot | null;
  /** Tacadas dadas na partida. */
  shots: number;
  /** Epoch ms em que a animação da última tacada termina (antes disso não dá para tacar). */
  readyAt: number;
  /** Epoch ms when the shot times out; null when the match is over. */
  turnDeadline: number | null;
}

export interface TacadaMatchResult {
  winner: number;
  reason: TacadaEndReason;
}

/** Public table state: identical for everybody (no hidden information). */
export interface TacadaRoomState {
  code: string;
  version: number;
  hostId: string;
  isPublic: boolean;
  /** Aposta de cada jogador nesta mesa (Arena). */
  stake: number;
  rules: TacadaRules;
  phase: TacadaRoomPhase;
  lobbyStatus: TacadaLobbyStatus | null;
  seats: (TacadaSeatPlayer | null)[];
  /** Lugar que dá a saída na partida atual ou na próxima (alterna na revanche). */
  breakerSeat: number;
  game: TacadaGameView | null;
  result: TacadaMatchResult | null;
}

export interface TacadaPublicRoom {
  code: string;
  hostNickname: string;
  hostCharacter: string | null;
  stake: number;
  players: number;
  rules: TacadaRules;
}

export const TACADA_PUBLIC_ROOMS_CHANNEL = 'tacada-public-rooms';

export interface TacadaSnapshot {
  state: TacadaRoomState;
  mySeat: number;
}

export const TACADA_EMOTES = [
  'laugh',
  'shock',
  'angry',
  'clap',
  'fire',
  'pray',
] as const;
export type TacadaEmote = (typeof TACADA_EMOTES)[number];

/** Grupo de uma bola numerada (a 8 e a branca não têm grupo). */
export const tacadaGroupOf = (ball: number): TacadaGroup | null =>
  ball >= 1 && ball <= 7
    ? 'solids'
    : ball >= 9 && ball <= 15
      ? 'stripes'
      : null;

/** Bolas do grupo ainda na mesa. */
export const tacadaRemaining = (
  balls: readonly TacadaBallPos[],
  group: TacadaGroup,
): number => {
  let n = 0;
  for (let i = 1; i < balls.length; i++)
    if (balls[i] && tacadaGroupOf(i) === group) n++;
  return n;
};

// ---------------------------------------------------------------------------
// Socket.IO events (namespace /tacada)
// ---------------------------------------------------------------------------

export const TACADA_NAMESPACE = '/tacada';

export const TacadaClientEvents = {
  CREATE: 'tacada:create',
  WATCH_ROOMS: 'tacada:watch_rooms',
  UNWATCH_ROOMS: 'tacada:unwatch_rooms',
  SET_VISIBILITY: 'tacada:set_visibility',
  /** Host only, lobby only: how much each player bets. */
  SET_STAKE: 'tacada:set_stake',
  SET_RULES: 'tacada:set_rules',
  JOIN: 'tacada:join',
  SYNC: 'tacada:sync',
  LEAVE: 'tacada:leave',
  READY: 'tacada:ready',
  /** Host only, lobby only: a CPU takes the first free seat. */
  ADD_BOT: 'tacada:add_bot',
  REMOVE_BOT: 'tacada:remove_bot',
  START: 'tacada:start',
  REMATCH: 'tacada:rematch',
  /** Mira ao vivo (só quem joga; repassada ao adversário, sem confirmação). */
  AIM: 'tacada:aim',
  SHOOT: 'tacada:shoot',
  RESIGN: 'tacada:resign',
  EMOTE: 'tacada:emote',
} as const;

export const TacadaServerEvents = {
  STATE: 'tacada:state',
  ROOMS_UPDATED: 'tacada:rooms_updated',
  ROOM_CLOSED: 'tacada:room_closed',
  EMOTED: 'tacada:emoted',
  AIMED: 'tacada:aimed',
  PLAYER_JOINED: 'tacada:player_joined',
  PLAYER_LEFT: 'tacada:player_left',
  PLAYER_DISCONNECTED: 'tacada:player_disconnected',
  PLAYER_RECONNECTED: 'tacada:player_reconnected',
  MATCH_STARTED: 'tacada:match_started',
  SHOT: 'tacada:shot',
  TURN_TIMED_OUT: 'tacada:turn_timed_out',
  MATCH_OVER: 'tacada:match_over',
} as const;

const actionIdSchema = z.string().min(8).max(64);
const unit = z.number().finite().min(-1).max(1);
const coord = z.number().finite().min(-10).max(300);

export const tacadaEmptySchema = z.object({}).strict();
export const tacadaCreateSchema = z
  .object({ isPublic: z.boolean().default(true) })
  .strict();
export const tacadaVisibilitySchema = z.object({ isPublic: z.boolean() });
export const tacadaSetRulesSchema = z.object({ rules: tacadaRulesSchema });
export const tacadaJoinSchema = z.object({ code: roomCodeSchema });
export const tacadaReadySchema = z.object({ ready: z.boolean() });
export const tacadaRemoveBotSchema = z.object({
  seat: z
    .number()
    .int()
    .min(0)
    .max(TACADA_SEATS - 1),
});
export const tacadaActionSchema = z.object({ actionId: actionIdSchema });
export const tacadaShootSchema = z.object({
  actionId: actionIdSchema,
  /** Direção (o servidor normaliza). */
  dirX: unit,
  dirY: unit,
  power: z.number().finite().min(0).max(1),
  spinX: unit,
  spinY: unit,
  /** Onde colocar a branca, quando está com a bola na mão. */
  cueX: coord.optional(),
  cueY: coord.optional(),
  /** Caçapa cantada para a 8 (0–5), obrigatória quando vai na 8. */
  pocket: z.number().int().min(0).max(5).optional(),
});
export const tacadaAimSchema = z.object({
  dirX: unit,
  dirY: unit,
  power: z.number().finite().min(0).max(1),
  cueX: coord.optional(),
  cueY: coord.optional(),
});
export const tacadaEmoteSchema = z.object({ emote: z.enum(TACADA_EMOTES) });

export type TacadaLeftReason = 'left' | 'expired' | 'removed';

export interface TacadaAim {
  seat: number;
  dirX: number;
  dirY: number;
  power: number;
  cueX?: number;
  cueY?: number;
}

/** Every announcement carries a room-wide sequence number so clients can drop duplicates. */
export interface TacadaServerEventPayloads {
  'tacada:state': TacadaRoomState;
  'tacada:rooms_updated': { rooms: TacadaPublicRoom[] };
  'tacada:room_closed': { reason: 'empty' };
  'tacada:emoted': { seat: number; emote: TacadaEmote };
  'tacada:aimed': TacadaAim;
  'tacada:player_joined': { seq: number; player: TacadaSeatPlayer };
  'tacada:player_left': {
    seq: number;
    seat: number;
    userId: string;
    reason: TacadaLeftReason;
  };
  'tacada:player_disconnected': {
    seq: number;
    seat: number;
    reconnectDeadline: number;
  };
  'tacada:player_reconnected': { seq: number; seat: number };
  'tacada:match_started': { seq: number; breakerSeat: number };
  'tacada:shot': {
    seq: number;
    shot: TacadaShotRecord;
    result: TacadaLastShot;
  };
  'tacada:turn_timed_out': { seq: number; seat: number };
  'tacada:match_over': { seq: number } & TacadaMatchResult;
}
export type TacadaServerEventName = keyof TacadaServerEventPayloads;

export interface TacadaClientAckData {
  'tacada:create': TacadaSnapshot;
  'tacada:watch_rooms': TacadaPublicRoom[];
  'tacada:unwatch_rooms': null;
  'tacada:set_visibility': null;
  'tacada:set_stake': null;
  'tacada:set_rules': null;
  'tacada:join': TacadaSnapshot;
  'tacada:sync': TacadaSnapshot;
  'tacada:leave': null;
  'tacada:ready': null;
  'tacada:add_bot': null;
  'tacada:remove_bot': null;
  'tacada:start': null;
  'tacada:rematch': null;
  'tacada:aim': null;
  'tacada:shoot': null;
  'tacada:resign': null;
  'tacada:emote': null;
}

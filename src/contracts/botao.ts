import { z } from 'zod';
import { roomCodeSchema } from './room';

// ---------------------------------------------------------------------------
// Mesa e regras
// ---------------------------------------------------------------------------

/** Lugares 0..3 são do time vermelho, 4..7 do azul. */
export const BOTAO_TEAM_SIZE = 4;
export const BOTAO_SEATS = BOTAO_TEAM_SIZE * 2;
/** Simulação e envio de quadros (Hz); cada quadro roda BOTAO_SUBSTEPS passos de física. */
export const BOTAO_TICK_RATE = 30;
export const BOTAO_TICK_MS = 1000 / BOTAO_TICK_RATE;
export const BOTAO_SUBSTEPS = 2;
export const BOTAO_DT = 1 / BOTAO_TICK_RATE;

/** Contagem antes do primeiro apito. */
export const BOTAO_COUNTDOWN = 2.5;
/** Comemoração depois do gol (a bola volta ao meio quando acaba). */
export const BOTAO_GOAL_PAUSE = 2.5;
/** Apito final: tudo para um instante antes do placar. */
export const BOTAO_END_PAUSE = 2;

export const BOTAO_TEAMS = [
  { id: 'red', name: 'Vermelho', color: '#e56e56', dark: '#8a2f22' },
  { id: 'blue', name: 'Azul', color: '#5689e5', dark: '#1f3f80' },
] as const;

export const botaoTeamOf = (seat: number) => (seat < BOTAO_TEAM_SIZE ? 0 : 1);

export const BOTAO_MINUTES = [2, 3, 5, 10] as const;
/** 0 = sem limite (só o tempo decide). */
export const BOTAO_GOAL_LIMITS = [0, 1, 3, 5, 7] as const;

export const botaoRulesSchema = z
  .object({
    minutes: z.union([z.literal(2), z.literal(3), z.literal(5), z.literal(10)]),
    /** Quem chegar a este número de gols vence na hora (0 = só o tempo). */
    goals: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(3),
      z.literal(5),
      z.literal(7),
    ]),
  })
  .strict();
export type BotaoRules = z.infer<typeof botaoRulesSchema>;
export const DEFAULT_BOTAO_RULES: BotaoRules = { minutes: 3, goals: 3 };

// ---------------------------------------------------------------------------
// Estado da sala
// ---------------------------------------------------------------------------

export const BOTAO_ROOM_PHASES = ['LOBBY', 'PLAYING', 'FINISHED'] as const;
export type BotaoRoomPhase = (typeof BOTAO_ROOM_PHASES)[number];
export type BotaoLobbyStatus = 'WAITING_PLAYERS' | 'READY_TO_START';

export interface BotaoSeatPlayer {
  seat: number;
  /** CPU tem id sintético (`cpu:N`). */
  userId: string;
  nickname: string;
  character: string | null;
  bot: boolean;
  ready: boolean;
  connected: boolean;
  /** Epoch ms em que o lugar reservado é liberado; null enquanto conectado. */
  reconnectDeadline: number | null;
}

export interface BotaoGoal {
  /** Time que marcou. */
  team: number;
  /** Quem tocou por último (null se saiu da sala). */
  scorer: number | null;
  /** Gol contra (o último toque foi do time que sofreu). */
  own: boolean;
  /** Segundos de jogo quando entrou. */
  at: number;
}

export interface BotaoMatchResult {
  /** Time campeão; 0 vermelho, 1 azul. */
  winner: number;
  score: [number, number];
  goals: BotaoGoal[];
  /** O outro time ficou sem ninguém. */
  walkover: boolean;
}

/** Estado da sala (lobby e placar). O jogo em si viaja nos quadros. */
export interface BotaoRoomState {
  code: string;
  version: number;
  hostId: string;
  isPublic: boolean;
  /** Aposta de cada jogador nesta mesa (Arena). */
  stake: number;
  rules: BotaoRules;
  phase: BotaoRoomPhase;
  lobbyStatus: BotaoLobbyStatus | null;
  seats: (BotaoSeatPlayer | null)[];
  score: [number, number];
  goals: BotaoGoal[];
  result: BotaoMatchResult | null;
}

export interface BotaoSnapshot {
  state: BotaoRoomState;
  mySeat: number;
  frame: BotaoFrame | null;
}

export interface BotaoPublicRoom {
  code: string;
  hostNickname: string;
  hostCharacter: string | null;
  stake: number;
  /** Jogadores por time. */
  players: [number, number];
  rules: BotaoRules;
}

export const BOTAO_PUBLIC_ROOMS_CHANNEL = 'botao-public-rooms';

// ---------------------------------------------------------------------------
// Quadros (um por tick enquanto a partida roda)
// ---------------------------------------------------------------------------

/**
 * countdown: todos parados; kickoff: esperando a saída de bola; play: bola rolando;
 * goal: comemoração; ending: apito final; over: acabou.
 */
export type BotaoMatchPhase =
  'countdown' | 'kickoff' | 'play' | 'goal' | 'ending' | 'over';

/** [lugar, x, y, vx, vy, chute armado (segurando e ainda não chutou), lastSeq] */
export type BotaoFramePlayer = [
  number,
  number,
  number,
  number,
  number,
  0 | 1,
  number,
];
/** [x, y, vx, vy] */
export type BotaoFrameBall = [number, number, number, number];

export type BotaoFrameEvent =
  | { k: 'whistle' }
  | { k: 'kick'; seat: number }
  | { k: 'touch' }
  | { k: 'post' }
  | { k: 'net' }
  | { k: 'goal'; team: number; scorer: number | null; own: boolean }
  | { k: 'end' };

export interface BotaoFrame {
  phase: BotaoMatchPhase;
  /** Segundos que faltam da fase (contagem, comemoração, apito final). */
  phaseLeft: number;
  /** Segundos de jogo que faltam; na prorrogação, segundos jogados nela. */
  clock: number;
  /** Gol de ouro: empate no fim do tempo, o próximo gol decide. */
  overtime: boolean;
  /** Quem dá a saída na fase kickoff. */
  kickTeam: number;
  score: [number, number];
  players: BotaoFramePlayer[];
  ball: BotaoFrameBall;
  events: BotaoFrameEvent[];
}

// ---------------------------------------------------------------------------
// Socket.IO (namespace /botao)
// ---------------------------------------------------------------------------

export const BOTAO_NAMESPACE = '/botao';

export const BotaoClientEvents = {
  CREATE: 'botao:create',
  WATCH_ROOMS: 'botao:watch_rooms',
  UNWATCH_ROOMS: 'botao:unwatch_rooms',
  SET_VISIBILITY: 'botao:set_visibility',
  /** Só o anfitrião, só no lobby: quanto cada um aposta. */
  SET_STAKE: 'botao:set_stake',
  SET_RULES: 'botao:set_rules',
  JOIN: 'botao:join',
  SYNC: 'botao:sync',
  LEAVE: 'botao:leave',
  READY: 'botao:ready',
  /** Troca de time no lobby (vai para o primeiro lugar livre do outro lado). */
  SET_TEAM: 'botao:set_team',
  ADD_BOT: 'botao:add_bot',
  REMOVE_BOT: 'botao:remove_bot',
  START: 'botao:start',
  REMATCH: 'botao:rematch',
  /** Sem ack, um por tick do cliente. */
  INPUT: 'botao:input',
} as const;

export const BotaoServerEvents = {
  STATE: 'botao:state',
  FRAME: 'botao:frame',
  ROOMS_UPDATED: 'botao:rooms_updated',
  ROOM_CLOSED: 'botao:room_closed',
  PLAYER_JOINED: 'botao:player_joined',
  PLAYER_LEFT: 'botao:player_left',
  PLAYER_DISCONNECTED: 'botao:player_disconnected',
  PLAYER_RECONNECTED: 'botao:player_reconnected',
  MATCH_STARTED: 'botao:match_started',
  GOAL: 'botao:goal',
  MATCH_OVER: 'botao:match_over',
} as const;

const teamSchema = z.union([z.literal(0), z.literal(1)]);

export const botaoEmptySchema = z.object({}).strict();
export const botaoCreateSchema = z
  .object({ isPublic: z.boolean().default(true) })
  .strict();
export const botaoVisibilitySchema = z.object({ isPublic: z.boolean() });
export const botaoSetRulesSchema = z.object({ rules: botaoRulesSchema });
export const botaoJoinSchema = z.object({ code: roomCodeSchema });
export const botaoReadySchema = z.object({ ready: z.boolean() });
export const botaoTeamSchema = z.object({ team: teamSchema });
/** Sem time: a CPU entra no lado com menos gente. */
export const botaoAddBotSchema = z.object({ team: teamSchema.optional() });
export const botaoRemoveBotSchema = z.object({
  seat: z
    .number()
    .int()
    .min(0)
    .max(BOTAO_SEATS - 1),
});
export const botaoInputSchema = z.object({
  /** Número de sequência do cliente, devolvido como lastSeq para a previsão. */
  s: z.number().int().min(0).max(2_147_483_647),
  /** Bits de direção (1 cima, 2 baixo, 4 esquerda, 8 direita). */
  d: z.number().int().min(0).max(15),
  /** Botão de chute segurado neste tick. */
  k: z.boolean(),
});
export type BotaoInput = z.infer<typeof botaoInputSchema>;

export type BotaoLeftReason = 'left' | 'expired' | 'removed';

/** Anúncios levam um número de sequência da sala para o cliente descartar repetidos. */
export interface BotaoServerEventPayloads {
  'botao:state': BotaoRoomState;
  'botao:frame': BotaoFrame;
  'botao:rooms_updated': { rooms: BotaoPublicRoom[] };
  'botao:room_closed': { reason: 'empty' };
  'botao:player_joined': { seq: number; player: BotaoSeatPlayer };
  'botao:player_left': {
    seq: number;
    seat: number;
    userId: string;
    reason: BotaoLeftReason;
  };
  'botao:player_disconnected': {
    seq: number;
    seat: number;
    reconnectDeadline: number;
  };
  'botao:player_reconnected': { seq: number; seat: number };
  'botao:match_started': { seq: number };
  'botao:goal': { seq: number; goal: BotaoGoal; score: [number, number] };
  'botao:match_over': { seq: number } & BotaoMatchResult;
}
export type BotaoServerEventName = keyof BotaoServerEventPayloads;

export interface BotaoClientAckData {
  'botao:create': BotaoSnapshot;
  'botao:watch_rooms': BotaoPublicRoom[];
  'botao:unwatch_rooms': null;
  'botao:set_visibility': null;
  'botao:set_stake': null;
  'botao:set_rules': null;
  'botao:join': BotaoSnapshot;
  'botao:sync': BotaoSnapshot;
  'botao:leave': null;
  'botao:ready': null;
  'botao:set_team': null;
  'botao:add_bot': null;
  'botao:remove_bot': null;
  'botao:start': null;
  'botao:rematch': null;
}

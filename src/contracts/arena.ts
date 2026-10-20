import { z } from 'zod';

/**
 * Arena: a economia e o ranking únicos de todos os jogos.
 *
 * - Moedas: toda disputa tem uma entrada (ante). O pote reúne o que foi cobrado de verdade
 *   (ninguém paga mais do que tem) e vai para quem ficou no topo; a casa soma bônus por cima.
 * - Pontos (ranking): rating estilo Elo calculado contra os adversários da mesa, com peso por
 *   jogo (sorte pesa menos que habilidade). Vencer um adversário mais forte vale mais.
 * - Anti-abuso: só conta contra jogadores logados, partida muito curta não pontua, repetir o
 *   mesmo adversário tem retorno decrescente e abandonar custa caro.
 */

export const ARENA_GAMES = [
  'BINGO',
  'UNO',
  'TRUCO',
  'DOMINO',
  'SNAKE',
  'BOMBER',
  'INFILTRADO',
  'DAMAS',
  'BLACKJACK',
  'TACADA',
] as const;
export type ArenaGame = (typeof ARENA_GAMES)[number];

export const ARENA_GAME_LABELS: Record<ArenaGame, string> = {
  BINGO: 'Bingo',
  UNO: 'UNO',
  TRUCO: 'Truco',
  DOMINO: 'Dominó',
  SNAKE: 'Snake.io',
  BOMBER: 'Bomber',
  INFILTRADO: 'Infiltrado',
  DAMAS: 'Damas',
  BLACKJACK: 'Blackjack',
  TACADA: 'Tacada',
};

export interface ArenaRules {
  /** Entrada de cada jogador; cobrada até o saldo acabar (nunca fica negativo). */
  ante: number;
  /** Bônus da casa para quem vence (soma-se ao pote). */
  winBonus: number;
  /** Peso no rating: jogos de sorte pesam menos, habilidade pesa mais. */
  ratingWeight: number;
  /** Abaixo disto a partida não pontua nem rende bônus (anti-combinação). */
  minRatedMs: number;
  /** Quem fica até o fim leva isto, vencendo ou não. */
  finishBonus: number;
  /** Se a partida entra na sequência de vitórias/derrotas (Snake é duelo avulso: não entra). */
  countsStreak: boolean;
}

export const ARENA_RULES: Record<ArenaGame, ArenaRules> = {
  BINGO: {
    ante: 20,
    winBonus: 60,
    ratingWeight: 0.5,
    minRatedMs: 30_000,
    finishBonus: 5,
    countsStreak: true,
  },
  UNO: {
    ante: 30,
    winBonus: 50,
    ratingWeight: 0.8,
    minRatedMs: 60_000,
    finishBonus: 5,
    countsStreak: true,
  },
  TRUCO: {
    ante: 40,
    winBonus: 60,
    ratingWeight: 1,
    minRatedMs: 90_000,
    finishBonus: 5,
    countsStreak: true,
  },
  DOMINO: {
    ante: 30,
    winBonus: 50,
    ratingWeight: 0.8,
    minRatedMs: 90_000,
    finishBonus: 5,
    countsStreak: true,
  },
  // Snake: cada abate é um duelo (o abatido paga a recompensa por quem o derrubou).
  SNAKE: {
    ante: 10,
    winBonus: 5,
    ratingWeight: 0.35,
    minRatedMs: 15_000,
    finishBonus: 0,
    countsStreak: false,
  },
  BOMBER: {
    ante: 30,
    winBonus: 50,
    ratingWeight: 1,
    minRatedMs: 60_000,
    finishBonus: 5,
    countsStreak: true,
  },
  // Infiltrado: o time vencedor divide o pote; dedução pesa mais que sorte.
  INFILTRADO: {
    ante: 30,
    winBonus: 40,
    ratingWeight: 0.7,
    minRatedMs: 120_000,
    finishBonus: 5,
    countsStreak: true,
  },
  // Damas: duelo de pura habilidade (informação completa, sem sorte).
  DAMAS: {
    ante: 30,
    winBonus: 50,
    ratingWeight: 1,
    minRatedMs: 90_000,
    finishBonus: 5,
    countsStreak: true,
  },
  // Blackjack: torneio de fichas contra o dealer; as cartas pesam muito, a gestão da banca decide.
  BLACKJACK: {
    ante: 30,
    winBonus: 40,
    ratingWeight: 0.5,
    minRatedMs: 60_000,
    finishBonus: 5,
    countsStreak: true,
  },
  // Tacada: bilhar 1x1; mira e controle de força decidem, com um tico de sorte na saída.
  TACADA: {
    ante: 30,
    winBonus: 50,
    ratingWeight: 0.9,
    minRatedMs: 90_000,
    finishBonus: 5,
    countsStreak: true,
  },
};

/** Quem abandona paga a entrada de novo (vai para o pote de quem ficou). */
export const ABANDON_PENALTY_MULTIPLIER = 1;
/** Primeira vitória do dia (fuso de São Paulo). */
export const FIRST_WIN_OF_DAY_COINS = 40;
/** Vencer quem tem rating médio ao menos isto acima do seu. */
export const UNDERDOG_GAP = 150;
export const UNDERDOG_COINS = 25;
/** Vencer depois de {COMEBACK_LOSSES} derrotas seguidas. */
export const COMEBACK_LOSSES = 3;
export const COMEBACK_COINS = 30;
/** Cada vitória seguida além da primeira: +coins e +pontos (até o teto). */
export const STREAK_COINS_STEP = 10;
export const STREAK_POINTS_STEP = 1;
export const STREAK_CAP = 5;

/** Rating: pontos do perfil + base formam a escala Elo (400). */
export const RATING_BASE = 1000;
export const RATING_SCALE = 400;
/** Fator K por experiência: novatos sobem/descem mais rápido até o rating se acomodar. */
export const RATING_K = [
  { upToMatches: 10, k: 40 },
  { upToMatches: 50, k: 28 },
  { upToMatches: Infinity, k: 20 },
] as const;
/** Vencer uma partida pontuada nunca rende menos que isto. */
export const MIN_WIN_POINTS = 4;

/** Mesmo adversário nas últimas {PAIR_WINDOW_MS}: depois de N confrontos o ganho cai. */
export const PAIR_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PAIR_FULL_MATCHES = 3;
export const PAIR_HALF_MATCHES = 8;

/** Divisão do pote com 4+ jogadores e 3+ colocações distintas; senão o topo leva tudo. */
export const POT_SPLIT = [0.6, 0.3, 0.1] as const;

export const TIERS = [
  { id: 'BRONZE', label: 'Bronze', min: 0, bonus: 0 },
  { id: 'PRATA', label: 'Prata', min: 150, bonus: 100 },
  { id: 'OURO', label: 'Ouro', min: 400, bonus: 250 },
  { id: 'PLATINA', label: 'Platina', min: 800, bonus: 500 },
  { id: 'DIAMANTE', label: 'Diamante', min: 1500, bonus: 1000 },
  { id: 'LENDA', label: 'Lenda', min: 3000, bonus: 2500 },
] as const;
export type TierId = (typeof TIERS)[number]['id'];

/** Índice da liga (0 = Bronze) para uma pontuação. */
export function tierIndexFor(points: number): number {
  let index = 0;
  TIERS.forEach((t, i) => {
    if (points >= t.min) index = i;
  });
  return index;
}

/** Ranking semanal: premia o top 3 de quem jogou o mínimo de partidas pontuadas na semana. */
export const WEEKLY_PRIZES = [1000, 500, 250] as const;
export const WEEKLY_MIN_MATCHES = 5;

export const BONUS_CODES = [
  'FINISH',
  'WIN',
  'STREAK',
  'FIRST_WIN',
  'UNDERDOG',
  'COMEBACK',
] as const;
export type BonusCode = (typeof BONUS_CODES)[number];

export const BONUS_LABELS: Record<BonusCode, string> = {
  FINISH: 'Partida concluída',
  WIN: 'Bônus de vitória',
  STREAK: 'Sequência de vitórias',
  FIRST_WIN: 'Primeira vitória do dia',
  UNDERDOG: 'Venceu quem era mais forte',
  COMEBACK: 'Virada depois de derrotas',
};

export const matchResultSchema = z.object({
  matchId: z.string(),
  game: z.enum(ARENA_GAMES),
  placement: z.number().int().min(1),
  players: z.number().int().min(2),
  won: z.boolean(),
  abandoned: z.boolean(),
  /** Variação real de pontos (já com o piso em 0). */
  pointsDelta: z.number().int(),
  /** Saldo líquido da partida: prêmio + bônus − entrada − multa. */
  coinsDelta: z.number().int(),
  staked: z.number().int().min(0),
  prize: z.number().int().min(0),
  bonuses: z.array(
    z.object({ code: z.enum(BONUS_CODES), amount: z.number().int() }),
  ),
  /** Sequência após a partida: > 0 vitórias seguidas, < 0 derrotas seguidas. */
  streak: z.number().int(),
  points: z.number().int(),
  /** Liga nova alcançada nesta partida (com o bônus pago), se houve. */
  tierUp: z
    .object({
      tier: z.enum(TIERS.map((t) => t.id) as [TierId, ...TierId[]]),
      coins: z.number().int(),
    })
    .nullable(),
  /** Só jogadores logados pontuam; convidado vê o motivo. */
  rated: z.boolean(),
  createdAt: z.string(),
});
export type MatchResultDto = z.infer<typeof matchResultSchema>;

/** GET /arena/latest: `now` é a hora do servidor, para a tela comparar sem depender do relógio do aparelho. */
export const latestResultResponseSchema = z.object({
  result: matchResultSchema.nullable(),
  now: z.string(),
});
export type LatestResultResponse = z.infer<typeof latestResultResponseSchema>;

export const latestResultQuerySchema = z.object({
  /** ISO: só resultados criados depois disto (a tela espera o da partida que acabou de terminar). */
  since: z.iso.datetime().optional(),
});

/**
 * Mesas com aposta: o anfitrião escolhe quanto vale a mesa (múltiplo da entrada mínima do jogo).
 * O mínimo de cada jogo é `ARENA_RULES[game].ante`. Mesas altas pedem liga (anti-conta-nova) e
 * pagam uma taxa da casa sobre o pote, que tira moedas de circulação. Bônus da casa e pontos
 * não mudam com a aposta: o ranking continua medindo habilidade, não saldo.
 */
export const STAKE_LEVELS = [
  { id: 'AMISTOSA', label: 'Amistosa', multiplier: 1, minTier: 0, rake: 0 },
  { id: 'VALENDO', label: 'Valendo', multiplier: 2, minTier: 0, rake: 0 },
  { id: 'ALTA', label: 'Alta', multiplier: 5, minTier: 1, rake: 0.05 },
  {
    id: 'HIGH_ROLLER',
    label: 'High Roller',
    multiplier: 10,
    minTier: 2,
    rake: 0.05,
  },
  { id: 'VIP', label: 'VIP', multiplier: 25, minTier: 3, rake: 0.05 },
] as const;
export type StakeLevelId = (typeof STAKE_LEVELS)[number]['id'];

export interface StakeOption {
  id: StakeLevelId;
  label: string;
  multiplier: number;
  /** Índice em TIERS exigido para sentar (0 = qualquer um, inclusive convidado). */
  minTier: number;
  /** Parte do pote que fica com a casa. */
  rake: number;
  stake: number;
}

/** Valores de aposta disponíveis num jogo, do mínimo ao maior. */
export function stakeOptions(game: ArenaGame): StakeOption[] {
  const ante = ARENA_RULES[game].ante;
  return STAKE_LEVELS.map((l) => ({ ...l, stake: ante * l.multiplier }));
}

/** O nível de uma aposta; undefined = valor que o jogo não oferece. */
export function stakeLevel(
  game: ArenaGame,
  stake: number,
): StakeOption | undefined {
  return stakeOptions(game).find((o) => o.stake === stake);
}

export function minStake(game: ArenaGame): number {
  return ARENA_RULES[game].ante;
}

/** Payload de `<jogo>:set_stake` (só o anfitrião, no lobby). */
export const setStakeSchema = z.object({
  stake: z.number().int().positive(),
});

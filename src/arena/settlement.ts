import {
  ABANDON_PENALTY_MULTIPLIER,
  ARENA_RULES,
  COMEBACK_COINS,
  COMEBACK_LOSSES,
  FIRST_WIN_OF_DAY_COINS,
  MIN_WIN_POINTS,
  PAIR_FULL_MATCHES,
  PAIR_HALF_MATCHES,
  POT_SPLIT,
  RATING_BASE,
  RATING_K,
  RATING_SCALE,
  STREAK_CAP,
  STREAK_COINS_STEP,
  STREAK_POINTS_STEP,
  UNDERDOG_COINS,
  UNDERDOG_GAP,
  type ArenaGame,
  type ArenaRules,
  type BonusCode,
} from '../contracts';

/**
 * Regras da Arena como funções puras: recebem quem jogou e devolvem o plano de
 * pontos, bônus e divisão do pote. O banco só aplica o plano (ArenaService).
 */

export interface Entrant {
  userId: string;
  /** 1 = melhor. Empates (times) repetem o número. */
  placement: number;
  abandoned: boolean;
  /** Logado: só estes pontuam e ganham os bônus de sequência. */
  logged: boolean;
  points: number;
  ratedMatches: number;
  streak: number;
  /** A "primeira vitória do dia" ainda está disponível. */
  firstWinAvailable: boolean;
}

export interface SettlementInput {
  game: ArenaGame;
  entrants: Entrant[];
  durationMs: number;
  /** Multiplicador do bônus de vitória (ex.: bingo em quina vale metade). */
  bonusScale?: number;
  /** Confrontos recentes entre dois jogadores (0..). Decide o retorno decrescente. */
  pairMatches?: (a: string, b: string) => number;
}

export interface PlanEntry {
  userId: string;
  won: boolean;
  placement: number;
  abandoned: boolean;
  rated: boolean;
  /** Variação de pontos antes do piso em 0 (o serviço aplica o piso). */
  pointsDelta: number;
  stake: number;
  penalty: number;
  /** Parte do pote (soma 1 entre os premiados). */
  potShare: number;
  bonuses: Array<{ code: BonusCode; amount: number }>;
  streakAfter: number;
}

export interface SettlementPlan {
  entries: PlanEntry[];
  rated: boolean;
}

/** Retorno decrescente de repetir o mesmo adversário em 24 h. */
export function pairFactor(prior: number): number {
  if (prior < PAIR_FULL_MATCHES) return 1;
  if (prior < PAIR_HALF_MATCHES) return 0.5;
  return 0;
}

export function kFactor(ratedMatches: number): number {
  return RATING_K.find((r) => ratedMatches < r.upToMatches)!.k;
}

function expected(mine: number, theirs: number): number {
  return 1 / (1 + 10 ** ((theirs - mine) / RATING_SCALE));
}

/**
 * Parte do pote por colocação: com 4+ jogadores e 3+ colocações distintas divide 60/30/10;
 * senão o topo leva tudo. Empatados dividem os lugares que ocupam. Abandono não recebe.
 */
export function potShares(
  entrants: ReadonlyArray<Pick<Entrant, 'placement' | 'abandoned'>>,
): number[] {
  const distinct = new Set(entrants.map((e) => e.placement)).size;
  const split = entrants.length >= 4 && distinct >= 3;
  const slots = split ? POT_SPLIT : [1];
  const order = entrants
    .map((e, i) => ({ i, p: e.placement }))
    .sort((a, b) => a.p - b.p || a.i - b.i);
  const raw = new Array<number>(entrants.length).fill(0);
  let slot = 0;
  while (slot < order.length) {
    let end = slot;
    while (end + 1 < order.length && order[end + 1].p === order[slot].p) end++;
    let sum = 0;
    for (let s = slot; s <= end; s++) sum += slots[s] ?? 0;
    const each = sum / (end - slot + 1);
    for (let s = slot; s <= end; s++) raw[order[s].i] = each;
    slot = end + 1;
  }
  entrants.forEach((e, i) => {
    if (e.abandoned) raw[i] = 0;
  });
  const total = raw.reduce((a, b) => a + b, 0);
  if (total > 0) return raw.map((w) => w / total);
  // Só sobrou quem abandonou ou o topo abandonou: o pote vai para quem ficou, em partes iguais.
  const stayed = entrants.filter((e) => !e.abandoned).length;
  return entrants.map((e) => (e.abandoned || stayed === 0 ? 0 : 1 / stayed));
}

/** Divide `pot` em inteiros que somam exatamente `pot` (a sobra vai para a maior parte). */
export function splitPot(pot: number, shares: readonly number[]): number[] {
  const parts = shares.map((s) => Math.floor(pot * s));
  const left = pot - parts.reduce((a, b) => a + b, 0);
  if (left > 0 && shares.some((s) => s > 0)) {
    parts[shares.indexOf(Math.max(...shares))] += left;
  }
  return parts;
}

interface Resolved extends Entrant {
  won: boolean;
}

interface Rating {
  rated: boolean;
  pointsDelta: number;
  /** Média do retorno decrescente contra os adversários (1 = sem repetição). */
  meanPair: number;
  ratedOpponents: Entrant[];
}

function ratingFor(
  me: Resolved,
  opponents: Entrant[],
  rules: ArenaRules,
  matchRated: boolean,
  pair: (a: string, b: string) => number,
): Rating {
  const ratedOpponents = opponents.filter((o) => o.logged);
  const factors = (list: Entrant[]): number[] =>
    list.map((o) => pairFactor(pair(me.userId, o.userId)));
  const mean = (xs: number[]): number =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1;

  if (!matchRated || !me.logged || ratedOpponents.length === 0) {
    return {
      rated: false,
      pointsDelta: 0,
      meanPair: mean(factors(opponents)),
      ratedOpponents,
    };
  }
  // Média dos confrontos 1×1 contra cada adversário logado.
  const meRating = RATING_BASE + me.points;
  const f = factors(ratedOpponents);
  const k = kFactor(me.ratedMatches) * rules.ratingWeight;
  let sum = 0;
  ratedOpponents.forEach((o, i) => {
    const s = me.placement < o.placement ? 1 : 0;
    sum += f[i] * (s - expected(meRating, RATING_BASE + o.points));
  });
  const meanPair = mean(f);
  let pointsDelta = Math.round((k * sum) / ratedOpponents.length);
  if (me.won && meanPair > 0) {
    const floor = Math.max(1, Math.round(MIN_WIN_POINTS * rules.ratingWeight));
    pointsDelta = Math.max(pointsDelta, floor);
  }
  return { rated: true, pointsDelta, meanPair, ratedOpponents };
}

function nextStreak(me: Resolved, rules: ArenaRules, valid: boolean): number {
  if (!rules.countsStreak || !(valid || me.abandoned)) return me.streak;
  if (me.won) return me.streak > 0 ? me.streak + 1 : 1;
  return me.streak < 0 ? me.streak - 1 : -1;
}

function bonusesFor(
  me: Resolved,
  rating: Rating,
  rules: ArenaRules,
  streakAfter: number,
  bonusScale: number,
): PlanEntry['bonuses'] {
  const bonuses: PlanEntry['bonuses'] = [];
  const add = (code: BonusCode, amount: number): void => {
    const rounded = Math.round(amount);
    if (rounded > 0) bonuses.push({ code, amount: rounded });
  };
  const f = rating.meanPair;
  add('FINISH', rules.finishBonus);
  if (!me.won) return bonuses;
  add('WIN', rules.winBonus * bonusScale * f);
  // Convidado ganha o prêmio básico; os bônus de progressão pedem conta logada.
  if (!me.logged) return bonuses;
  if (rules.countsStreak) {
    add(
      'STREAK',
      Math.min(streakAfter - 1, STREAK_CAP) * STREAK_COINS_STEP * f,
    );
    if (me.firstWinAvailable) add('FIRST_WIN', FIRST_WIN_OF_DAY_COINS * f);
    if (me.streak <= -COMEBACK_LOSSES) add('COMEBACK', COMEBACK_COINS * f);
  }
  const opp = rating.ratedOpponents;
  if (opp.length > 0) {
    const avg =
      opp.reduce((a, o) => a + RATING_BASE + o.points, 0) / opp.length;
    if (avg - (RATING_BASE + me.points) >= UNDERDOG_GAP)
      add('UNDERDOG', UNDERDOG_COINS * f);
  }
  return bonuses;
}

export function planSettlement(input: SettlementInput): SettlementPlan {
  const rules = ARENA_RULES[input.game];
  const bonusScale = input.bonusScale ?? 1;
  const pair = input.pairMatches ?? (() => 0);

  // Quem abandona fica atrás de todo mundo, mesmo que estivesse na frente.
  const stayed = input.entrants.filter((e) => !e.abandoned);
  const worst = Math.max(0, ...stayed.map((e) => e.placement)) + 1;
  const placed = input.entrants.map((e) => ({
    ...e,
    placement: e.abandoned ? worst : e.placement,
  }));
  const best = Math.min(...placed.map((e) => e.placement));
  const entrants: Resolved[] = placed.map((e) => ({
    ...e,
    won: !e.abandoned && e.placement === best,
  }));

  const valid = input.durationMs >= rules.minRatedMs;
  const rated = valid && entrants.filter((e) => e.logged).length >= 2;
  const shares = potShares(entrants);

  const entries = entrants.map((me, idx): PlanEntry => {
    const opponents = entrants.filter((o) => o.placement !== me.placement);
    const rating = ratingFor(me, opponents, rules, rated, pair);
    const streakAfter = nextStreak(me, rules, valid);
    // Partida curta demais não rende bônus; quem abandonou nunca recebe.
    const bonuses =
      valid && !me.abandoned
        ? bonusesFor(me, rating, rules, streakAfter, bonusScale)
        : [];
    let pointsDelta = rating.pointsDelta;
    if (rating.rated && me.won && pointsDelta > 0 && streakAfter > 1)
      pointsDelta += Math.min(streakAfter - 1, STREAK_CAP) * STREAK_POINTS_STEP;
    return {
      userId: me.userId,
      won: me.won,
      placement: me.placement,
      abandoned: me.abandoned,
      rated: rating.rated,
      pointsDelta,
      stake: rules.ante,
      penalty: me.abandoned ? rules.ante * ABANDON_PENALTY_MULTIPLIER : 0,
      potShare: shares[idx],
      bonuses,
      streakAfter,
    };
  });

  return { entries, rated };
}

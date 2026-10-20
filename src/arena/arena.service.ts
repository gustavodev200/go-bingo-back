import { Injectable, Logger } from '@nestjs/common';
import { chargeUpTo, credit, saoPauloDay } from '../coins/ledger';
import {
  PAIR_WINDOW_MS,
  stakeLevel,
  TIERS,
  tierIndexFor,
  type ArenaGame,
  type MatchResultDto,
  type TierId,
} from '../contracts';
import { DomainError } from '../core/domain-error';
import { isUniqueViolation } from '../core/prisma-errors';
import { PrismaService } from '../core/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import {
  planSettlement,
  rakeOf,
  splitPot,
  type Entrant,
  type PlanEntry,
} from './settlement';
import { checkStake } from './stake-guard';

export interface MatchParticipant {
  userId: string;
  /** 1 = melhor; times repetem o número. */
  placement: number;
  abandoned?: boolean;
}

export interface MatchInput {
  /** Id (uuid) único da disputa: liquidar duas vezes o mesmo id não paga duas vezes. */
  matchId: string;
  game: ArenaGame;
  durationMs: number;
  participants: MatchParticipant[];
  /** Multiplicador do bônus de vitória (ex.: bingo em quina). */
  bonusScale?: number;
  /** Já contado em outro ponto (bingo conta ao iniciar). */
  skipGamesPlayed?: boolean;
  /** Aposta da mesa; ausente = mínimo do jogo. Mesas altas pagam taxa da casa sobre o pote. */
  stake?: number;
}

type Tx = Prisma.TransactionClient;

interface PostRow {
  points: number;
  bestTier: number;
}

/**
 * Liquida uma disputa de qualquer jogo: cobra as entradas, monta o pote, paga a colocação,
 * soma os bônus da casa e atualiza rating, sequência e liga. Tudo numa transação.
 */
@Injectable()
export class ArenaService {
  private readonly logger = new Logger(ArenaService.name);

  /** Liquidações dos jogos em memória andam em fila: uma de cada vez, sem esgotar o pool de conexões. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly prisma: PrismaService) {}

  /** Para os jogos em memória: enfileira e nunca derruba a partida por falha de banco. */
  settleSafe(input: MatchInput): Promise<Map<string, MatchResultDto> | null> {
    const run = this.queue.then(() => this.settleLogged(input));
    this.queue = run;
    return run;
  }

  private async settleLogged(
    input: MatchInput,
  ): Promise<Map<string, MatchResultDto> | null> {
    try {
      return await this.settle(input);
    } catch (error) {
      this.logger.error(
        `settle ${input.game} ${input.matchId} falhou`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  /** null = já liquidada antes (idempotente) ou sem jogadores suficientes. */
  async settle(input: MatchInput): Promise<Map<string, MatchResultDto> | null> {
    if (input.participants.length < 2) return null;
    try {
      return await this.prisma.$transaction((tx) => this.settleIn(tx, input));
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  /**
   * Confere se estes jogadores podem sentar numa mesa com esta aposta: o valor existe no jogo,
   * todos têm a liga exigida e saldo para pagar a entrada. Chamado ao entrar, ao mudar a aposta
   * e ao iniciar (a cobrança de verdade é na liquidação, até o saldo).
   */
  async assertStake(
    game: ArenaGame,
    stake: number,
    userIds: readonly string[],
  ): Promise<void> {
    if (!stakeLevel(game, stake))
      throw new DomainError(
        'INVALID_PAYLOAD',
        'Aposta inválida para este jogo',
      );
    if (userIds.length === 0) return;
    const rows = await this.prisma.profile.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, nickname: true, coins: true, points: true },
    });
    for (const r of rows)
      checkStake(
        game,
        stake,
        r,
        userIds.length === 1 ? 'Você' : (r.nickname ?? 'Um jogador'),
      );
  }

  async latest(userId: string, since?: Date): Promise<MatchResultDto | null> {
    const row = await this.prisma.matchResult.findFirst({
      where: { userId, ...(since ? { createdAt: { gt: since } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toDto(row) : null;
  }

  /** Liquida dentro da transação de quem chama (o bingo fecha a partida e paga na mesma). */
  async settleIn(
    tx: Tx,
    input: MatchInput,
  ): Promise<Map<string, MatchResultDto> | null> {
    const ids = [...new Set(input.participants.map((p) => p.userId))].sort();
    const profiles = await tx.profile.findMany({ where: { id: { in: ids } } });
    if (profiles.length < 2) return null;
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const now = new Date();
    const today = saoPauloDay(now);

    const history = await tx.matchResult.findMany({
      where: {
        userId: { in: ids },
        createdAt: { gte: new Date(now.getTime() - PAIR_WINDOW_MS) },
      },
      select: { matchId: true, userId: true },
    });
    const pairMatches = pairCounter(history);

    const entrants: Entrant[] = input.participants
      .filter((p) => byId.has(p.userId))
      .map((p) => {
        const profile = byId.get(p.userId)!;
        return {
          userId: p.userId,
          placement: p.placement,
          abandoned: p.abandoned ?? false,
          logged: !profile.isGuest,
          points: profile.points,
          ratedMatches: profile.ratedMatches,
          streak: profile.streak,
          firstWinAvailable:
            profile.lastWinBonusOn === null || profile.lastWinBonusOn < today,
        };
      });
    const plan = planSettlement({
      game: input.game,
      entrants,
      durationMs: input.durationMs,
      bonusScale: input.bonusScale,
      stake: input.stake,
      pairMatches,
    });
    const entries = [...plan.entries].sort((a, b) =>
      a.userId < b.userId ? -1 : 1,
    );

    // Entradas e multas: só entra no pote o que foi cobrado de verdade.
    const staked = await chargeUpTo(
      tx,
      entries.map((e) => e.userId),
      entries[0].stake,
      'STAKE',
      input.matchId,
    );
    const leavers = entries.filter((e) => e.penalty > 0);
    const penalised = leavers.length
      ? await chargeUpTo(
          tx,
          leavers.map((e) => e.userId),
          leavers[0].penalty,
          'PENALTY',
          input.matchId,
        )
      : new Map<string, number>();
    const gross = sum([...staked.values()]) + sum([...penalised.values()]);
    const level = stakeLevel(input.game, entries[0].stake);
    const pot = gross - rakeOf(gross, level?.rake ?? 0);
    const prizes = new Map<string, number>();
    const ordered = plan.entries;
    splitPot(
      pot,
      ordered.map((e) => e.potShare),
    ).forEach((amount, i) => prizes.set(ordered[i].userId, amount));

    const out = new Map<string, MatchResultDto>();
    const rows: Prisma.MatchResultCreateManyInput[] = [];
    for (const entry of entries) {
      const profile = byId.get(entry.userId)!;
      const prize = prizes.get(entry.userId) ?? 0;
      const bonus = sum(entry.bonuses.map((b) => b.amount));
      if (prize > 0)
        await credit(tx, entry.userId, prize, 'PRIZE', input.matchId);
      if (bonus > 0)
        await credit(tx, entry.userId, bonus, 'BONUS', input.matchId);

      const firstWin = entry.bonuses.some((b) => b.code === 'FIRST_WIN');
      const post = await this.updateProfile(tx, entry, {
        rated: entry.rated,
        countGame: !input.skipGamesPlayed,
        winDay: firstWin ? today : null,
      });
      const tierUp = await this.promote(tx, entry.userId, post, input.matchId);

      const stakedNow =
        (staked.get(entry.userId) ?? 0) + (penalised.get(entry.userId) ?? 0);
      const coinsDelta = prize + bonus + (tierUp?.coins ?? 0) - stakedNow;
      const result: MatchResultDto = {
        matchId: input.matchId,
        game: input.game,
        placement: entry.placement,
        players: entries.length,
        won: entry.won,
        abandoned: entry.abandoned,
        pointsDelta: post.points - profile.points,
        coinsDelta,
        staked: stakedNow,
        prize,
        bonuses: entry.bonuses,
        streak: entry.streakAfter,
        points: post.points,
        tierUp,
        rated: entry.rated,
        createdAt: now.toISOString(),
      };
      out.set(entry.userId, result);
      rows.push({
        userId: entry.userId,
        matchId: result.matchId,
        game: result.game,
        placement: result.placement,
        players: result.players,
        won: result.won,
        abandoned: result.abandoned,
        rated: result.rated,
        pointsDelta: result.pointsDelta,
        coinsDelta: result.coinsDelta,
        staked: result.staked,
        prize: result.prize,
        bonuses: result.bonuses,
        streak: result.streak,
        pointsAfter: result.points,
        tierUp: tierUp ?? undefined,
        createdAt: now,
      });
    }
    await tx.matchResult.createMany({ data: rows });
    return out;
  }

  /** Pontos com piso em 0, sequência, calibração e o dia da primeira vitória. */
  private async updateProfile(
    tx: Tx,
    entry: PlanEntry,
    opts: { rated: boolean; countGame: boolean; winDay: Date | null },
  ): Promise<PostRow> {
    const rows = await tx.$queryRaw<PostRow[]>`
      UPDATE "Profile" SET
        "points" = GREATEST("points" + ${entry.pointsDelta}, 0),
        "streak" = ${entry.streakAfter},
        "bestStreak" = GREATEST("bestStreak", ${entry.streakAfter}),
        "ratedMatches" = "ratedMatches" + ${opts.rated ? 1 : 0},
        "gamesPlayed" = "gamesPlayed" + ${opts.countGame ? 1 : 0},
        "lastWinBonusOn" = COALESCE(${opts.winDay}::date, "lastWinBonusOn")
      WHERE "id" = ${entry.userId}::uuid
      RETURNING "points", "bestTier"`;
    return rows[0];
  }

  /** Sobe de liga: paga o bônus de cada liga nova (uma única vez, guardado em bestTier). */
  private async promote(
    tx: Tx,
    userId: string,
    post: PostRow,
    matchId: string,
  ): Promise<{ tier: TierId; coins: number } | null> {
    const reached = tierIndexFor(post.points);
    if (reached <= post.bestTier) return null;
    const coins = sum(
      TIERS.slice(post.bestTier + 1, reached + 1).map((t) => t.bonus),
    );
    await tx.profile.update({
      where: { id: userId },
      data: { bestTier: reached },
    });
    if (coins > 0) await credit(tx, userId, coins, 'TIER', matchId);
    return { tier: TIERS[reached].id, coins };
  }
}

type ResultRow = Prisma.MatchResultGetPayload<object>;

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Quantas partidas das últimas 24 h dois jogadores dividiram. */
function pairCounter(
  history: Array<{ matchId: string; userId: string }>,
): (a: string, b: string) => number {
  const players = new Map<string, Set<string>>();
  for (const h of history) {
    const set = players.get(h.matchId) ?? new Set<string>();
    set.add(h.userId);
    players.set(h.matchId, set);
  }
  return (a, b) => {
    let n = 0;
    for (const set of players.values()) if (set.has(a) && set.has(b)) n++;
    return n;
  };
}

export function toDto(row: ResultRow): MatchResultDto {
  const bonuses = Array.isArray(row.bonuses)
    ? (row.bonuses as unknown as MatchResultDto['bonuses'])
    : [];
  return {
    matchId: row.matchId,
    game: row.game,
    placement: row.placement,
    players: row.players,
    won: row.won,
    abandoned: row.abandoned,
    pointsDelta: row.pointsDelta,
    coinsDelta: row.coinsDelta,
    staked: row.staked,
    prize: row.prize,
    bonuses,
    streak: row.streak,
    points: row.pointsAfter,
    tierUp: (row.tierUp as MatchResultDto['tierUp']) ?? null,
    rated: row.rated,
    createdAt: row.createdAt.toISOString(),
  };
}

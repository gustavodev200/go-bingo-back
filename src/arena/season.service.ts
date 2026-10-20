import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { credit, creditDiamonds } from '../coins/ledger';
import {
  WEEKLY_DIAMONDS,
  WEEKLY_MIN_MATCHES,
  WEEKLY_PRIZES,
} from '../contracts';
import { isUniqueViolation } from '../core/prisma-errors';
import { PrismaService } from '../core/prisma.service';
import { addWeeks, weekKey, weekStart } from './week';

interface Winner {
  id: string;
  points: number;
}

/** Paga o top 3 do ranking semanal quando a semana fecha (e recupera se o servidor estava fora do ar). */
@Injectable()
export class SeasonService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeasonService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.payLastWeek();
  }

  @Cron('10 0 * * 1', { timeZone: 'America/Sao_Paulo' })
  async payLastWeek(now = new Date()): Promise<number> {
    try {
      return await this.pay(addWeeks(weekStart(now), -1));
    } catch (error) {
      this.logger.error(
        'prêmio semanal falhou',
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    }
  }

  /** Idempotente: (semana, posição) é único, então pagar de novo não duplica. */
  async pay(start: Date): Promise<number> {
    const from = start.toISOString();
    const to = addWeeks(start, 1).toISOString();
    const top = await this.prisma.$queryRaw<Winner[]>`
      SELECT m."userId" AS "id", SUM(m."pointsDelta")::int AS "points"
      FROM "MatchResult" m JOIN "Profile" p ON p."id" = m."userId"
      WHERE m."createdAt" >= ${from}::timestamp AND m."createdAt" < ${to}::timestamp
        AND p."isGuest" = false
      GROUP BY m."userId"
      HAVING SUM(m."pointsDelta") > 0 AND COUNT(*) FILTER (WHERE m."rated") >= ${WEEKLY_MIN_MATCHES}
      ORDER BY "points" DESC, m."userId" ASC
      LIMIT ${WEEKLY_PRIZES.length}`;
    let paid = 0;
    for (const [i, winner] of top.entries()) {
      const coins = WEEKLY_PRIZES[i];
      const diamonds = WEEKLY_DIAMONDS[i] ?? 0;
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.seasonPayout.create({
            data: {
              weekStart: weekKey(start),
              rank: i + 1,
              userId: winner.id,
              coins,
              diamonds,
              points: winner.points,
            },
          });
          await credit(tx, winner.id, coins, 'SEASON');
          if (diamonds > 0)
            await creditDiamonds(tx, winner.id, diamonds, 'SEASON');
        });
        paid++;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    return paid;
  }
}

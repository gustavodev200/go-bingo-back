import { Injectable } from '@nestjs/common';
import { weekStart } from '../arena/week';
import type { RankingResponse, RankingScope } from '../contracts';
import { PrismaService } from '../core/prisma.service';

const PAGE_SIZE = 50;
const ELIGIBLE = { isGuest: false, gamesPlayed: { gt: 0 } } as const;

interface WeekRow {
  id: string;
  nickname: string | null;
  points: number;
  matches: number;
}

@Injectable()
export class RankingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    viewerId: string,
    offset: number,
    scope: RankingScope = 'all',
  ): Promise<RankingResponse> {
    if (scope === 'week') return this.listWeek(viewerId, offset);
    return this.listAll(viewerId, offset);
  }

  /** Ranking da semana: soma dos pontos ganhos em todos os jogos desde segunda 00:00 (São Paulo). */
  private async listWeek(
    viewerId: string,
    offset: number,
  ): Promise<RankingResponse> {
    const since = weekStart(new Date()).toISOString();
    const rows = await this.prisma.$queryRaw<WeekRow[]>`
      SELECT m."userId" AS "id", p."nickname", SUM(m."pointsDelta")::int AS "points",
             (COUNT(*) FILTER (WHERE m."rated"))::int AS "matches"
      FROM "MatchResult" m JOIN "Profile" p ON p."id" = m."userId"
      WHERE m."createdAt" >= ${since}::timestamp AND p."isGuest" = false
      GROUP BY m."userId", p."nickname"
      HAVING SUM(m."pointsDelta") > 0
      ORDER BY "points" DESC, m."userId" ASC
      OFFSET ${offset} LIMIT ${PAGE_SIZE + 1}`;
    return {
      entries: rows.slice(0, PAGE_SIZE).map((r, i) => ({
        rank: offset + i + 1,
        userId: r.id,
        nickname: r.nickname ?? 'Jogador',
        points: r.points,
        matches: r.matches,
      })),
      me: await this.weekPosition(viewerId, since),
      nextCursor: rows.length > PAGE_SIZE ? offset + PAGE_SIZE : null,
      scope: 'week',
    };
  }

  private async weekPosition(
    viewerId: string,
    since: string,
  ): Promise<RankingResponse['me']> {
    const [mine] = await this.prisma.$queryRaw<
      Array<{ points: number | null; matches: number }>
    >`
      SELECT SUM(m."pointsDelta")::int AS "points",
             (COUNT(*) FILTER (WHERE m."rated"))::int AS "matches"
      FROM "MatchResult" m JOIN "Profile" p ON p."id" = m."userId"
      WHERE m."userId" = ${viewerId}::uuid AND m."createdAt" >= ${since}::timestamp
        AND p."isGuest" = false`;
    if (!mine?.points || mine.points <= 0) return null;
    const [ahead] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS "n" FROM (
        SELECT m."userId" FROM "MatchResult" m JOIN "Profile" p ON p."id" = m."userId"
        WHERE m."createdAt" >= ${since}::timestamp AND p."isGuest" = false
        GROUP BY m."userId"
        HAVING SUM(m."pointsDelta") > ${mine.points}
           OR (SUM(m."pointsDelta") = ${mine.points} AND m."userId" < ${viewerId}::uuid)
      ) t`;
    return {
      rank: (ahead?.n ?? 0) + 1,
      points: mine.points,
      matches: mine.matches,
    };
  }

  private async listAll(
    viewerId: string,
    offset: number,
  ): Promise<RankingResponse> {
    const rows = await this.prisma.profile.findMany({
      where: ELIGIBLE,
      orderBy: [{ points: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: PAGE_SIZE + 1,
    });
    const entries = rows.slice(0, PAGE_SIZE).map((p, i) => ({
      rank: offset + i + 1,
      userId: p.id,
      nickname: p.nickname ?? 'Jogador',
      points: p.points,
    }));
    return {
      entries,
      me: await this.position(viewerId),
      nextCursor: rows.length > PAGE_SIZE ? offset + PAGE_SIZE : null,
      scope: 'all',
    };
  }

  async position(viewerId: string): Promise<RankingResponse['me']> {
    const me = await this.prisma.profile.findUnique({
      where: { id: viewerId },
    });
    if (!me || me.isGuest || me.gamesPlayed === 0) return null;
    // Mesma ordem da lista: pontos desc, id asc.
    const ahead = await this.prisma.profile.count({
      where: {
        ...ELIGIBLE,
        OR: [
          { points: { gt: me.points } },
          { points: me.points, id: { lt: me.id } },
        ],
      },
    });
    return { rank: ahead + 1, points: me.points };
  }
}

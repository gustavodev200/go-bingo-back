import { Injectable } from '@nestjs/common';
import type { RankingResponse } from '../contracts';
import { PrismaService } from '../core/prisma.service';

const PAGE_SIZE = 50;
const ELIGIBLE = { isGuest: false, gamesPlayed: { gt: 0 } } as const;

@Injectable()
export class RankingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(viewerId: string, offset: number): Promise<RankingResponse> {
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

import type { PrismaService } from '../core/prisma.service';
import { RankingService } from './ranking.service';

function makePrisma() {
  return {
    profile: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
}

describe('RankingService', () => {
  it('lists eligible players ranked by points, with no next page when short of a full page', async () => {
    const prisma = makePrisma();
    prisma.profile.findMany.mockResolvedValue([
      { id: 'u1', nickname: 'Ana', points: 50 },
      { id: 'u2', nickname: null, points: 10 },
    ]);
    prisma.profile.findUnique.mockResolvedValue(null);
    const service = new RankingService(prisma as unknown as PrismaService);

    const result = await service.list('viewer', 0);

    expect(result.entries).toEqual([
      { rank: 1, userId: 'u1', nickname: 'Ana', points: 50 },
      { rank: 2, userId: 'u2', nickname: 'Jogador', points: 10 },
    ]);
    expect(result.nextCursor).toBeNull();
    expect(prisma.profile.findMany).toHaveBeenCalledWith({
      where: { isGuest: false, gamesPlayed: { gt: 0 } },
      orderBy: [{ points: 'desc' }, { id: 'asc' }],
      skip: 0,
      take: 51,
    });
  });

  it('returns a nextCursor when a full page plus one extra row comes back', async () => {
    const prisma = makePrisma();
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: `u${i}`,
      nickname: `P${i}`,
      points: 100 - i,
    }));
    prisma.profile.findMany.mockResolvedValue(rows);
    prisma.profile.findUnique.mockResolvedValue(null);
    const service = new RankingService(prisma as unknown as PrismaService);

    const result = await service.list('viewer', 0);

    expect(result.entries).toHaveLength(50);
    expect(result.nextCursor).toBe(50);
  });

  it('omits the viewer position when the viewer profile does not exist', async () => {
    const prisma = makePrisma();
    prisma.profile.findMany.mockResolvedValue([]);
    prisma.profile.findUnique.mockResolvedValue(null);
    const service = new RankingService(prisma as unknown as PrismaService);

    expect((await service.list('ghost', 0)).me).toBeNull();
  });

  it('omits the viewer position for guests, even if they have points', async () => {
    const prisma = makePrisma();
    prisma.profile.findMany.mockResolvedValue([]);
    prisma.profile.findUnique.mockResolvedValue({
      id: 'u1',
      isGuest: true,
      gamesPlayed: 5,
      points: 100,
    });
    const service = new RankingService(prisma as unknown as PrismaService);

    expect((await service.list('u1', 0)).me).toBeNull();
  });

  it('omits the viewer position for a registered player who never played', async () => {
    const prisma = makePrisma();
    prisma.profile.findMany.mockResolvedValue([]);
    prisma.profile.findUnique.mockResolvedValue({
      id: 'u1',
      isGuest: false,
      gamesPlayed: 0,
      points: 0,
    });
    const service = new RankingService(prisma as unknown as PrismaService);

    expect((await service.list('u1', 0)).me).toBeNull();
  });

  it('computes the viewer rank as 1 + the count of eligible players ahead', async () => {
    const prisma = makePrisma();
    prisma.profile.findMany.mockResolvedValue([]);
    prisma.profile.findUnique.mockResolvedValue({
      id: 'u1',
      isGuest: false,
      gamesPlayed: 3,
      points: 42,
    });
    prisma.profile.count.mockResolvedValue(4);
    const service = new RankingService(prisma as unknown as PrismaService);

    const result = await service.list('u1', 0);

    expect(result.me).toEqual({ rank: 5, points: 42 });
    expect(prisma.profile.count).toHaveBeenCalledWith({
      where: {
        isGuest: false,
        gamesPlayed: { gt: 0 },
        OR: [{ points: { gt: 42 } }, { points: 42, id: { lt: 'u1' } }],
      },
    });
  });
});

describe('RankingService weekly scope', () => {
  it('lists the week by points won across all games, with matches and the viewer position', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { id: 'u1', nickname: 'Ana', points: 90, matches: 7 },
        { id: 'u2', nickname: null, points: 40, matches: 2 },
      ])
      .mockResolvedValueOnce([{ points: 40, matches: 2 }]) // o próprio jogador
      .mockResolvedValueOnce([{ n: 1 }]); // quantos estão à frente
    const service = new RankingService(prisma as unknown as PrismaService);

    const result = await service.list('u2', 0, 'week');

    expect(result).toEqual({
      entries: [
        { rank: 1, userId: 'u1', nickname: 'Ana', points: 90, matches: 7 },
        { rank: 2, userId: 'u2', nickname: 'Jogador', points: 40, matches: 2 },
      ],
      me: { rank: 2, points: 40, matches: 2 },
      nextCursor: null,
      scope: 'week',
    });
  });

  it('pages the week board and hides the viewer when they have no points this week', async () => {
    const prisma = makePrisma();
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: `u${i}`,
      nickname: `P${i}`,
      points: 100 - i,
      matches: 3,
    }));
    prisma.$queryRaw
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([{ points: null, matches: 0 }]);
    const service = new RankingService(prisma as unknown as PrismaService);

    const result = await service.list('viewer', 50, 'week');

    expect(result.entries).toHaveLength(50);
    expect(result.entries[0].rank).toBe(51);
    expect(result.nextCursor).toBe(100);
    expect(result.me).toBeNull();
  });
});

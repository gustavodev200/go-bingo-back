import { Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../core/prisma.service';
import { ArenaService } from './arena.service';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const MATCH = '00000000-0000-4000-8000-0000000000aa';

function profile(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    isGuest: false,
    points: 100,
    ratedMatches: 100,
    streak: 0,
    // já ganhou hoje: sem o bônus de primeira vitória do dia
    lastWinBonusOn: new Date('2999-01-01T00:00:00.000Z'),
    ...over,
  };
}

/** Fake de PrismaService: $transaction roda o callback no mesmo objeto. */
function makePrisma() {
  const models = {
    profile: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    matchResult: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn(),
      findFirst: jest.fn(),
    },
    coinTransaction: { create: jest.fn(), createMany: jest.fn() },
    // 1ª chamada: entradas; depois UPDATEs de perfil (RETURNING points, bestTier).
    $queryRaw: jest.fn(),
  };
  return {
    ...models,
    $transaction: jest.fn((cb: (tx: typeof models) => unknown) => cb(models)),
  };
}

function wire(prisma: ReturnType<typeof makePrisma>, staked: number[]) {
  const [firstStake, secondStake] = staked;
  prisma.$queryRaw
    .mockResolvedValueOnce([
      { id: A, charged: firstStake },
      { id: B, charged: secondStake },
    ])
    .mockResolvedValueOnce([{ points: 112, bestTier: 0 }]) // A
    .mockResolvedValueOnce([{ points: 88, bestTier: 0 }]); // B
}

const input = {
  matchId: MATCH,
  game: 'TRUCO' as const,
  durationMs: 10 * 60_000,
  participants: [
    { userId: A, placement: 1 },
    { userId: B, placement: 2 },
  ],
};

describe('ArenaService.settle', () => {
  it('collects the stakes into a pot, pays the winner, adds house bonuses and records both results', async () => {
    const prisma = makePrisma();
    prisma.profile.findMany.mockResolvedValue([profile(A), profile(B)]);
    wire(prisma, [40, 40]);
    const service = new ArenaService(prisma as unknown as PrismaService);

    const results = await service.settle(input);

    const a = results!.get(A)!;
    const b = results!.get(B)!;
    expect(a).toMatchObject({
      won: true,
      staked: 40,
      prize: 80, // o pote inteiro (40 + 40)
      pointsDelta: 12,
      points: 112,
      streak: 1,
      rated: true,
    });
    expect(a.bonuses.map((x) => x.code)).toEqual(['FINISH', 'WIN']);
    expect(a.coinsDelta).toBe(80 + 5 + 60 - 40);
    expect(b).toMatchObject({
      won: false,
      staked: 40,
      prize: 0,
      pointsDelta: -12,
      coinsDelta: 5 - 40,
      streak: -1,
    });
    // Entradas saem como STAKE e o prêmio entra como PRIZE; bônus da casa em BONUS.
    expect(prisma.coinTransaction.createMany).toHaveBeenCalledWith({
      data: [
        { userId: A, amount: -40, reason: 'STAKE', gameId: MATCH },
        { userId: B, amount: -40, reason: 'STAKE', gameId: MATCH },
      ],
    });
    expect(prisma.coinTransaction.create).toHaveBeenCalledWith({
      data: { userId: A, amount: 80, reason: 'PRIZE', gameId: MATCH },
    });
    expect(prisma.coinTransaction.create).toHaveBeenCalledWith({
      data: { userId: A, amount: 65, reason: 'BONUS', gameId: MATCH },
    });
    expect(prisma.matchResult.createMany).toHaveBeenCalledTimes(1);
  });

  it('only pools what was really collected: a broke loser does not mint coins for the winner', async () => {
    const prisma = makePrisma();
    prisma.profile.findMany.mockResolvedValue([profile(A), profile(B)]);
    wire(prisma, [40, 0]);
    const service = new ArenaService(prisma as unknown as PrismaService);

    const results = await service.settle(input);

    expect(results!.get(A)!.prize).toBe(40);
    expect(results!.get(B)!.staked).toBe(0);
  });

  it('charges the leaver a second time and gives it to who stayed', async () => {
    const prisma = makePrisma();
    prisma.profile.findMany.mockResolvedValue([profile(A), profile(B)]);
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { id: A, charged: 40 },
        { id: B, charged: 40 },
      ])
      .mockResolvedValueOnce([{ id: B, charged: 40 }]) // multa
      .mockResolvedValueOnce([{ points: 112, bestTier: 0 }])
      .mockResolvedValueOnce([{ points: 88, bestTier: 0 }]);
    const service = new ArenaService(prisma as unknown as PrismaService);

    const results = await service.settle({
      ...input,
      participants: [
        { userId: A, placement: 1 },
        { userId: B, placement: 1, abandoned: true },
      ],
    });

    expect(results!.get(A)!.prize).toBe(120);
    expect(results!.get(B)).toMatchObject({
      abandoned: true,
      won: false,
      staked: 80,
    });
    expect(prisma.coinTransaction.createMany).toHaveBeenCalledWith({
      data: [{ userId: B, amount: -40, reason: 'PENALTY', gameId: MATCH }],
    });
  });

  it('pays the promotion bonus once when the points cross a league', async () => {
    const prisma = makePrisma();
    prisma.profile.findMany.mockResolvedValue([
      profile(A, { points: 140 }),
      profile(B),
    ]);
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { id: A, charged: 40 },
        { id: B, charged: 40 },
      ])
      .mockResolvedValueOnce([{ points: 152, bestTier: 0 }]) // A cruza 150
      .mockResolvedValueOnce([{ points: 88, bestTier: 0 }]);
    const service = new ArenaService(prisma as unknown as PrismaService);

    const results = await service.settle(input);

    expect(results!.get(A)!.tierUp).toEqual({ tier: 'PRATA', coins: 100 });
    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { id: A },
      data: { bestTier: 1 },
    });
    expect(prisma.coinTransaction.create).toHaveBeenCalledWith({
      data: { userId: A, amount: 100, reason: 'TIER', gameId: MATCH },
    });
    expect(results!.get(B)!.tierUp).toBeNull();
  });

  it('counts recent meetings between the same two players (anti-farm)', async () => {
    const prisma = makePrisma();
    prisma.profile.findMany.mockResolvedValue([profile(A), profile(B)]);
    prisma.matchResult.findMany.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => [
        { matchId: `m${i}`, userId: A },
        { matchId: `m${i}`, userId: B },
      ]).flat(),
    );
    wire(prisma, [40, 40]);
    prisma.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([
        { id: A, charged: 40 },
        { id: B, charged: 40 },
      ])
      .mockResolvedValueOnce([{ points: 100, bestTier: 0 }])
      .mockResolvedValueOnce([{ points: 100, bestTier: 0 }]);
    const service = new ArenaService(prisma as unknown as PrismaService);

    const results = await service.settle(input);

    expect(results!.get(A)!.pointsDelta).toBe(0);
    expect(results!.get(A)!.bonuses.map((x) => x.code)).toEqual(['FINISH']);
  });

  it('ignores a match with fewer than two known players', async () => {
    const prisma = makePrisma();
    prisma.profile.findMany.mockResolvedValue([profile(A)]);
    const service = new ArenaService(prisma as unknown as PrismaService);

    await expect(service.settle(input)).resolves.toBeNull();
    await expect(
      service.settle({ ...input, participants: [input.participants[0]] }),
    ).resolves.toBeNull();
    expect(prisma.matchResult.createMany).not.toHaveBeenCalled();
  });

  it('is idempotent: settling the same match again is a no-op', async () => {
    const prisma = makePrisma();
    prisma.profile.findMany.mockResolvedValue([profile(A), profile(B)]);
    wire(prisma, [40, 40]);
    prisma.matchResult.createMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '0.0.0',
      }),
    );
    const service = new ArenaService(prisma as unknown as PrismaService);

    await expect(service.settle(input)).resolves.toBeNull();
  });
});

describe('ArenaService.settleSafe', () => {
  it('never throws: a database failure is logged and swallowed', async () => {
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const prisma = makePrisma();
    prisma.profile.findMany.mockRejectedValue(new Error('db down'));
    const service = new ArenaService(prisma as unknown as PrismaService);

    await expect(service.settleSafe(input)).resolves.toBeNull();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('runs one settlement at a time, in order', async () => {
    const prisma = makePrisma();
    const order: string[] = [];
    prisma.profile.findMany.mockImplementation(async () => {
      order.push('start');
      await Promise.resolve();
      order.push('end');
      return [];
    });
    const service = new ArenaService(prisma as unknown as PrismaService);

    await Promise.all([service.settleSafe(input), service.settleSafe(input)]);

    expect(order).toEqual(['start', 'end', 'start', 'end']);
  });
});

describe('ArenaService.latest', () => {
  it('returns the newest result as a DTO, or null', async () => {
    const prisma = makePrisma();
    const at = new Date('2026-10-19T12:00:00.000Z');
    prisma.matchResult.findFirst.mockResolvedValueOnce({
      matchId: MATCH,
      game: 'UNO',
      placement: 1,
      players: 2,
      won: true,
      abandoned: false,
      rated: true,
      pointsDelta: 8,
      coinsDelta: 70,
      staked: 30,
      prize: 60,
      bonuses: [{ code: 'WIN', amount: 50 }],
      streak: 2,
      pointsAfter: 108,
      tierUp: null,
      createdAt: at,
    });
    prisma.matchResult.findFirst.mockResolvedValueOnce(null);
    const service = new ArenaService(prisma as unknown as PrismaService);

    const since = new Date('2026-10-19T11:00:00.000Z');
    await expect(service.latest(A, since)).resolves.toMatchObject({
      game: 'UNO',
      points: 108,
      bonuses: [{ code: 'WIN', amount: 50 }],
      createdAt: at.toISOString(),
    });
    expect(prisma.matchResult.findFirst).toHaveBeenCalledWith({
      where: { userId: A, createdAt: { gt: since } },
      orderBy: { createdAt: 'desc' },
    });
    await expect(service.latest(A)).resolves.toBeNull();
  });
});

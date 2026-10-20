import type { PrismaService } from '../core/prisma.service';
import { DiamondsService, nextClaimDay } from './diamonds.service';

// 2026-10-20 12:00 em São Paulo (15:00 UTC).
const NOW = new Date('2026-10-20T15:00:00.000Z');
const TODAY = new Date('2026-10-20T00:00:00.000Z');
const YESTERDAY = new Date('2026-10-19T00:00:00.000Z');
const OLD = new Date('2026-10-10T00:00:00.000Z');

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    isGuest: false,
    coins: 100,
    diamonds: 0,
    diamondStreak: 0,
    lastDiamondOn: null as Date | null,
    ...over,
  };
}

function makePrisma() {
  const models = {
    profile: {
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    diamondTransaction: { create: jest.fn(), createMany: jest.fn() },
    coinTransaction: { create: jest.fn() },
  };
  return {
    ...models,
    $transaction: jest.fn((cb: (tx: typeof models) => unknown) => cb(models)),
  };
}

describe('nextClaimDay', () => {
  it('starts a new cycle on the first claim or after a missed day', () => {
    expect(
      nextClaimDay({ diamondStreak: 0, lastDiamondOn: null }, TODAY),
    ).toEqual({ day: 1, claimedToday: false, shown: 0 });
    expect(
      nextClaimDay({ diamondStreak: 4, lastDiamondOn: OLD }, TODAY),
    ).toEqual({ day: 1, claimedToday: false, shown: 0 });
  });

  it('continues the cycle when the last claim was yesterday', () => {
    expect(
      nextClaimDay({ diamondStreak: 3, lastDiamondOn: YESTERDAY }, TODAY),
    ).toEqual({ day: 4, claimedToday: false, shown: 3 });
  });

  it('after day 7 the next claim opens a new cycle', () => {
    expect(
      nextClaimDay({ diamondStreak: 7, lastDiamondOn: YESTERDAY }, TODAY),
    ).toEqual({ day: 1, claimedToday: false, shown: 0 });
    expect(
      nextClaimDay({ diamondStreak: 7, lastDiamondOn: TODAY }, TODAY),
    ).toEqual({ day: 1, claimedToday: true, shown: 7 });
  });
});

describe('DiamondsService.claim', () => {
  it('pays the daily diamonds once and records the movement', async () => {
    const prisma = makePrisma();
    prisma.profile.findUniqueOrThrow
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(
        row({ diamonds: 10, diamondStreak: 1, lastDiamondOn: TODAY }),
      );
    const service = new DiamondsService(prisma as unknown as PrismaService);

    const res = await service.claim('u1', NOW);

    expect(res.claimed).toBe(10);
    expect(res.status).toMatchObject({
      diamonds: 10,
      streakDay: 1,
      claimedToday: true,
      nextReward: 10,
    });
    expect(prisma.profile.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'u1',
        OR: [{ lastDiamondOn: null }, { lastDiamondOn: { lt: TODAY } }],
      },
      data: {
        diamonds: { increment: 10 },
        diamondStreak: 1,
        lastDiamondOn: TODAY,
      },
    });
    expect(prisma.diamondTransaction.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u1', amount: 10, reason: 'DAILY' }],
    });
  });

  it('day 7 of the streak pays the bonus on top', async () => {
    const prisma = makePrisma();
    prisma.profile.findUniqueOrThrow.mockResolvedValue(
      row({ diamondStreak: 6, lastDiamondOn: YESTERDAY }),
    );
    const service = new DiamondsService(prisma as unknown as PrismaService);

    const res = await service.claim('u1', NOW);

    expect(res.claimed).toBe(25);
    expect(prisma.diamondTransaction.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'u1', amount: 10, reason: 'DAILY' },
        { userId: 'u1', amount: 15, reason: 'STREAK' },
      ],
    });
  });

  it('already claimed today (or lost the race): nothing is paid', async () => {
    const prisma = makePrisma();
    prisma.profile.findUniqueOrThrow.mockResolvedValue(
      row({ diamondStreak: 2, lastDiamondOn: TODAY }),
    );
    const service = new DiamondsService(prisma as unknown as PrismaService);
    await expect(service.claim('u1', NOW)).resolves.toMatchObject({
      claimed: 0,
    });
    expect(prisma.profile.updateMany).not.toHaveBeenCalled();

    const racing = makePrisma();
    racing.profile.findUniqueOrThrow.mockResolvedValue(row());
    racing.profile.updateMany.mockResolvedValue({ count: 0 });
    const other = new DiamondsService(racing as unknown as PrismaService);
    await expect(other.claim('u1', NOW)).resolves.toMatchObject({
      claimed: 0,
    });
    expect(racing.diamondTransaction.createMany).not.toHaveBeenCalled();
  });

  it('guests cannot claim (no farming with throwaway accounts)', async () => {
    const prisma = makePrisma();
    prisma.profile.findUniqueOrThrow.mockResolvedValue(row({ isGuest: true }));
    const service = new DiamondsService(prisma as unknown as PrismaService);
    await expect(service.claim('u1', NOW)).rejects.toMatchObject({
      code: 'GUEST_NOT_ALLOWED',
    });
  });
});

describe('DiamondsService.exchange', () => {
  it('turns a pack into coins with both movements recorded', async () => {
    const prisma = makePrisma();
    prisma.profile.findUniqueOrThrow.mockResolvedValue(
      row({ diamonds: 5, coins: 650 }),
    );
    const service = new DiamondsService(prisma as unknown as PrismaService);

    const res = await service.exchange('u1', 10, NOW);

    expect(res.coins).toBe(550);
    expect(prisma.profile.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', diamonds: { gte: 10 } },
      data: { diamonds: { decrement: 10 }, coins: { increment: 550 } },
    });
    expect(prisma.diamondTransaction.create).toHaveBeenCalledWith({
      data: { userId: 'u1', amount: -10, reason: 'EXCHANGE' },
    });
    expect(prisma.coinTransaction.create).toHaveBeenCalledWith({
      data: { userId: 'u1', amount: 550, reason: 'EXCHANGE' },
    });
  });

  it('refuses without enough diamonds or an unknown pack', async () => {
    const prisma = makePrisma();
    prisma.profile.updateMany.mockResolvedValue({ count: 0 });
    const service = new DiamondsService(prisma as unknown as PrismaService);
    await expect(service.exchange('u1', 50, NOW)).rejects.toMatchObject({
      code: 'INSUFFICIENT_DIAMONDS',
    });
    await expect(service.exchange('u1', 7, NOW)).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD',
    });
  });
});

describe('DiamondsService.status', () => {
  it('reports balance, cycle and eligibility', async () => {
    const prisma = makePrisma();
    prisma.profile.findUniqueOrThrow.mockResolvedValue(
      row({ isGuest: true, diamonds: 3 }),
    );
    const service = new DiamondsService(prisma as unknown as PrismaService);
    await expect(service.status('u1', NOW)).resolves.toEqual({
      diamonds: 3,
      coins: 100,
      streakDay: 0,
      claimedToday: false,
      nextReward: 10,
      eligible: false,
    });
  });
});

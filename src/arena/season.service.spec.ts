import { Logger } from '@nestjs/common';
import type { PrismaService } from '../core/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { SeasonService } from './season.service';
import { weekStart } from './week';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

function makePrisma() {
  const models = {
    seasonPayout: { create: jest.fn() },
    profile: { update: jest.fn() },
    coinTransaction: { create: jest.fn() },
  };
  return {
    ...models,
    $queryRaw: jest.fn(),
    $transaction: jest.fn((cb: (tx: typeof models) => unknown) => cb(models)),
  };
}

describe('SeasonService.pay', () => {
  const start = weekStart(new Date('2026-10-12T12:00:00Z'));

  it('pays the top of the board, one prize per rank, crediting the wallet', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([
      { id: A, points: 90 },
      { id: B, points: 40 },
    ]);
    const service = new SeasonService(prisma as unknown as PrismaService);

    await expect(service.pay(start)).resolves.toBe(2);

    expect(prisma.seasonPayout.create).toHaveBeenNthCalledWith(1, {
      data: {
        weekStart: new Date('2026-10-12T00:00:00.000Z'),
        rank: 1,
        userId: A,
        coins: 1000,
        points: 90,
      },
    });
    expect(prisma.seasonPayout.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        rank: 2,
        userId: B,
        coins: 500,
      }) as unknown,
    });
    expect(prisma.coinTransaction.create).toHaveBeenCalledWith({
      data: {
        userId: A,
        amount: 1000,
        reason: 'SEASON',
        gameId: undefined,
      },
    });
  });

  it('is idempotent: a prize already paid for that week and rank is skipped', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([{ id: A, points: 90 }]);
    prisma.seasonPayout.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '0.0.0',
      }),
    );
    const service = new SeasonService(prisma as unknown as PrismaService);

    await expect(service.pay(start)).resolves.toBe(0);
    expect(prisma.coinTransaction.create).not.toHaveBeenCalled();
  });

  it('payLastWeek closes the week before the current one and survives failures', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([]);
    const service = new SeasonService(prisma as unknown as PrismaService);

    await expect(
      service.payLastWeek(new Date('2026-10-19T03:20:00Z')),
    ).resolves.toBe(0);
    const [, from] = prisma.$queryRaw.mock.calls[0] as unknown[];
    expect(from).toBe('2026-10-12T03:00:00.000Z');

    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));
    await expect(service.payLastWeek()).resolves.toBe(0);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('catches up on boot', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([]);
    const service = new SeasonService(prisma as unknown as PrismaService);
    await service.onApplicationBootstrap();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

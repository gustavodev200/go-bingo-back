import { COIN_HISTORY_LIMIT, DAILY_COINS, WELCOME_COINS } from '../contracts';
import type { AuthUser } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import type { PrismaService } from '../core/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { ProfilesService } from './profiles.service';

function makePrisma() {
  const models = {
    profile: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    coinTransaction: { create: jest.fn(), findMany: jest.fn() },
    game: { count: jest.fn() },
  };
  return {
    ...models,
    $transaction: jest.fn((cb: (tx: typeof models) => unknown) => cb(models)),
  };
}

const row = {
  id: 'u1',
  nickname: 'Fulano',
  isGuest: false,
  points: 10,
  coins: 120,
  gamesPlayed: 2,
  lastDailyBonusOn: null,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

describe('ProfilesService.ensure', () => {
  it('returns the existing profile untouched when isGuest already matches', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue(row);
    const service = new ProfilesService(prisma as unknown as PrismaService);

    await expect(
      service.ensure({ id: 'u1', isAnonymous: false }),
    ).resolves.toBe(row);
    expect(prisma.profile.update).not.toHaveBeenCalled();
    expect(prisma.profile.create).not.toHaveBeenCalled();
  });

  it('mirrors is_anonymous into isGuest (guest who linked Google keeps the profile)', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ ...row, isGuest: true });
    prisma.profile.update.mockResolvedValue(row);
    const service = new ProfilesService(prisma as unknown as PrismaService);

    await service.ensure({ id: 'u1', isAnonymous: false });
    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isGuest: false },
    });
  });

  it('creates a new profile with the welcome coins and a ledger line', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue(null);
    prisma.profile.findUniqueOrThrow.mockResolvedValue({
      ...row,
      coins: WELCOME_COINS,
    });
    const service = new ProfilesService(prisma as unknown as PrismaService);

    const result = await service.ensure({ id: 'u1', isAnonymous: true });

    expect(prisma.profile.create).toHaveBeenCalledWith({
      data: { id: 'u1', isGuest: true },
    });
    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { coins: { increment: WELCOME_COINS } },
    });
    expect(prisma.coinTransaction.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        amount: WELCOME_COINS,
        reason: 'WELCOME',
        gameId: undefined,
      },
    });
    expect(result.coins).toBe(WELCOME_COINS);
  });

  it('a concurrent first access that lost the race just reads the profile (no double welcome)', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue(null);
    prisma.profile.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '0',
      }),
    );
    prisma.profile.findUniqueOrThrow.mockResolvedValue(row);
    const service = new ProfilesService(prisma as unknown as PrismaService);

    await expect(
      service.ensure({ id: 'u1', isAnonymous: false }),
    ).resolves.toBe(row);
    expect(prisma.coinTransaction.create).not.toHaveBeenCalled();
  });

  it('rethrows unexpected errors', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue(null);
    prisma.profile.create.mockRejectedValue(new Error('db down'));
    const service = new ProfilesService(prisma as unknown as PrismaService);

    await expect(
      service.ensure({ id: 'u1', isAnonymous: false }),
    ).rejects.toThrow('db down');
  });
});

describe('ProfilesService.claimDaily', () => {
  const now = new Date('2026-10-08T15:00:00Z');
  const today = new Date('2026-10-08T00:00:00.000Z');

  it('credits DAILY_COINS once per Brazilian day', async () => {
    const prisma = makePrisma();
    prisma.profile.updateMany.mockResolvedValue({ count: 1 });
    const service = new ProfilesService(prisma as unknown as PrismaService);

    await expect(service.claimDaily('u1', now)).resolves.toBe(DAILY_COINS);
    expect(prisma.profile.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'u1',
        OR: [{ lastDailyBonusOn: null }, { lastDailyBonusOn: { lt: today } }],
      },
      data: { coins: { increment: DAILY_COINS }, lastDailyBonusOn: today },
    });
    expect(prisma.coinTransaction.create).toHaveBeenCalledWith({
      data: { userId: 'u1', amount: DAILY_COINS, reason: 'DAILY' },
    });
  });

  it('gives nothing when already claimed today', async () => {
    const prisma = makePrisma();
    prisma.profile.updateMany.mockResolvedValue({ count: 0 });
    const service = new ProfilesService(prisma as unknown as PrismaService);

    await expect(service.claimDaily('u1', now)).resolves.toBe(0);
    expect(prisma.coinTransaction.create).not.toHaveBeenCalled();
  });
});

describe('ProfilesService.setNickname', () => {
  it('rejects a malformed nickname with the Zod message', async () => {
    const prisma = makePrisma();
    const service = new ProfilesService(prisma as unknown as PrismaService);
    const user: AuthUser = { id: 'u1', isAnonymous: false };

    await expect(service.setNickname(user, 'a')).rejects.toMatchObject({
      code: 'NICKNAME_INVALID',
    });
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it('rejects a well-formed but blocked nickname', async () => {
    const prisma = makePrisma();
    const service = new ProfilesService(prisma as unknown as PrismaService);
    const user: AuthUser = { id: 'u1', isAnonymous: false };

    await expect(service.setNickname(user, 'porra')).rejects.toEqual(
      new DomainError('NICKNAME_INVALID', 'Apelido não permitido'),
    );
  });

  it('ensures the profile exists, persists and returns the DTO', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue(row);
    prisma.profile.update.mockResolvedValue({ ...row, nickname: 'Novo Nome' });
    const service = new ProfilesService(prisma as unknown as PrismaService);
    const user: AuthUser = { id: 'u1', isAnonymous: false };

    const result = await service.setNickname(user, 'Novo Nome');

    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { nickname: 'Novo Nome' },
    });
    expect(result).toEqual({
      id: 'u1',
      nickname: 'Novo Nome',
      isGuest: false,
      points: 10,
      coins: 120,
    });
  });

  it('toDto() projects only the public profile fields', () => {
    const service = new ProfilesService({} as unknown as PrismaService);
    expect(service.toDto(row)).toEqual({
      id: 'u1',
      nickname: 'Fulano',
      isGuest: false,
      points: 10,
      coins: 120,
    });
  });
});

describe('ProfilesService.stats', () => {
  it('counts finished wins and returns the latest coin movements, newest first', async () => {
    const prisma = makePrisma();
    prisma.profile.findUniqueOrThrow.mockResolvedValue(row);
    prisma.game.count.mockResolvedValue(1);
    const at = new Date('2026-10-07T12:00:00.000Z');
    prisma.coinTransaction.findMany.mockResolvedValue([
      {
        id: 't2',
        amount: -5,
        reason: 'CARD',
        createdAt: at,
        userId: 'u1',
        gameId: null,
      },
    ]);
    const service = new ProfilesService(prisma as unknown as PrismaService);

    await expect(service.stats('u1')).resolves.toEqual({
      gamesPlayed: 2,
      wins: 1,
      points: 10,
      coinHistory: [
        { id: 't2', amount: -5, reason: 'CARD', createdAt: at.toISOString() },
      ],
    });
    expect(prisma.game.count).toHaveBeenCalledWith({
      where: { winnerId: 'u1', status: 'FINISHED' },
    });
    expect(prisma.coinTransaction.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: COIN_HISTORY_LIMIT,
    });
  });
});

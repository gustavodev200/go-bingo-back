import type { AuthUser } from '../core/auth/jwt-verifier';
import { ProfilesController } from './profiles.controller';
import type { RankingService } from '../ranking/ranking.service';
import type { ProfilesService } from './profiles.service';

describe('ProfilesController', () => {
  const user: AuthUser = { id: 'u1', isAnonymous: false };

  it('me() ensures the profile, claims the daily bonus and returns the updated balance', async () => {
    const row = { id: 'u1' };
    const dto = {
      id: 'u1',
      nickname: 'x',
      isGuest: false,
      points: 0,
      coins: 100,
    };
    const profiles = {
      ensure: jest.fn().mockResolvedValue(row),
      toDto: jest.fn().mockReturnValue(dto),
      claimDaily: jest.fn().mockResolvedValue(50),
    };
    const controller = new ProfilesController(
      profiles as unknown as ProfilesService,
      {} as RankingService,
    );

    await expect(controller.me(user)).resolves.toEqual({
      ...dto,
      coins: 150,
      dailyBonus: 50,
    });
    expect(profiles.ensure).toHaveBeenCalledWith(user);
    expect(profiles.claimDaily).toHaveBeenCalledWith('u1');
  });

  it('me() reports no bonus when it was already claimed today', async () => {
    const dto = {
      id: 'u1',
      nickname: 'x',
      isGuest: false,
      points: 0,
      coins: 100,
    };
    const profiles = {
      ensure: jest.fn().mockResolvedValue({}),
      toDto: jest.fn().mockReturnValue(dto),
      claimDaily: jest.fn().mockResolvedValue(0),
    };
    const controller = new ProfilesController(
      profiles as unknown as ProfilesService,
      {} as RankingService,
    );

    await expect(controller.me(user)).resolves.toEqual({
      ...dto,
      dailyBonus: 0,
    });
  });

  it('update() delegates nickname/character changes to the service', () => {
    const dto = { id: 'u1', nickname: 'Novo', isGuest: false, points: 0 };
    const profiles = {
      update: jest.fn().mockResolvedValue(dto),
    };
    const controller = new ProfilesController(
      profiles as unknown as ProfilesService,
      {} as RankingService,
    );

    const result = controller.update(user, {
      nickname: 'Novo',
      character: 'c03',
    });

    expect(profiles.update).toHaveBeenCalledWith(user, {
      nickname: 'Novo',
      character: 'c03',
    });
    return expect(result).resolves.toBe(dto);
  });
});

describe('ProfilesController.stats', () => {
  it('ensures the profile, then combines stats with the ranking position', async () => {
    const user: AuthUser = { id: 'u1', isAnonymous: false };
    const base = {
      gamesPlayed: 3,
      wins: 1,
      points: 20,
      coinHistory: [],
    };
    const profiles = {
      ensure: jest.fn().mockResolvedValue({ id: 'u1' }),
      stats: jest.fn().mockResolvedValue(base),
    };
    const ranking = {
      position: jest.fn().mockResolvedValue({ rank: 4, points: 20 }),
    };
    const controller = new ProfilesController(
      profiles as unknown as ProfilesService,
      ranking as unknown as RankingService,
    );

    await expect(controller.stats(user)).resolves.toEqual({ ...base, rank: 4 });
    expect(profiles.ensure).toHaveBeenCalledWith(user);
    expect(profiles.stats).toHaveBeenCalledWith('u1');
    expect(ranking.position).toHaveBeenCalledWith('u1');
  });

  it('reports no rank for players outside the ranking (guests, never played)', async () => {
    const profiles = {
      ensure: jest.fn(),
      stats: jest.fn().mockResolvedValue({
        gamesPlayed: 0,
        wins: 0,
        points: 0,
        coinHistory: [],
      }),
    };
    const ranking = { position: jest.fn().mockResolvedValue(null) };
    const controller = new ProfilesController(
      profiles as unknown as ProfilesService,
      ranking as unknown as RankingService,
    );

    await expect(
      controller.stats({ id: 'g1', isAnonymous: true }),
    ).resolves.toMatchObject({ rank: null });
  });
});

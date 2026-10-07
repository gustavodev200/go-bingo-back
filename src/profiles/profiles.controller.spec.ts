import type { AuthUser } from '../core/auth/jwt-verifier';
import { ProfilesController } from './profiles.controller';
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
    );

    await expect(controller.me(user)).resolves.toEqual({
      ...dto,
      dailyBonus: 0,
    });
  });

  it('update() delegates nickname changes to the service', () => {
    const dto = { id: 'u1', nickname: 'Novo', isGuest: false, points: 0 };
    const profiles = {
      setNickname: jest.fn().mockResolvedValue(dto),
    };
    const controller = new ProfilesController(
      profiles as unknown as ProfilesService,
    );

    const result = controller.update(user, { nickname: 'Novo' });

    expect(profiles.setNickname).toHaveBeenCalledWith(user, 'Novo');
    return expect(result).resolves.toBe(dto);
  });
});

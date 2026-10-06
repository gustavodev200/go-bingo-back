import type { AuthUser } from '../core/auth/jwt-verifier';
import { ProfilesController } from './profiles.controller';
import type { ProfilesService } from './profiles.service';

describe('ProfilesController', () => {
  const user: AuthUser = { id: 'u1', isAnonymous: false };

  it('me() ensures the profile exists and returns its DTO', async () => {
    const row = { id: 'u1', nickname: 'x', isGuest: false, points: 0 };
    const dto = { id: 'u1', nickname: 'x', isGuest: false, points: 0 };
    const profiles = {
      ensure: jest.fn().mockResolvedValue(row),
      toDto: jest.fn().mockReturnValue(dto),
    };
    const controller = new ProfilesController(
      profiles as unknown as ProfilesService,
    );

    await expect(controller.me(user)).resolves.toBe(dto);
    expect(profiles.ensure).toHaveBeenCalledWith(user);
    expect(profiles.toDto).toHaveBeenCalledWith(row);
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

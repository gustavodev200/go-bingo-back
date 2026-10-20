import type { ProfilesService } from '../profiles/profiles.service';
import { DiamondsController } from './diamonds.controller';
import type { DiamondsService } from './diamonds.service';

describe('DiamondsController', () => {
  const user = { id: 'u1', isAnonymous: false };

  function make() {
    const diamonds = {
      status: jest.fn().mockResolvedValue({ diamonds: 1 }),
      claim: jest.fn().mockResolvedValue({ claimed: 10 }),
      exchange: jest.fn().mockResolvedValue({ coins: 50 }),
    };
    const profiles = { ensure: jest.fn().mockResolvedValue({}) };
    const controller = new DiamondsController(
      diamonds as unknown as DiamondsService,
      profiles as unknown as ProfilesService,
    );
    return { diamonds, profiles, controller };
  }

  it('status and claim make sure the profile exists first', async () => {
    const { diamonds, profiles, controller } = make();
    await expect(controller.status(user)).resolves.toEqual({ diamonds: 1 });
    await expect(controller.claim(user)).resolves.toEqual({ claimed: 10 });
    expect(profiles.ensure).toHaveBeenCalledTimes(2);
    expect(diamonds.claim).toHaveBeenCalledWith('u1');
  });

  it('exchange passes the pack size', async () => {
    const { diamonds, controller } = make();
    await controller.exchange(user, { diamonds: 10 });
    expect(diamonds.exchange).toHaveBeenCalledWith('u1', 10);
  });
});

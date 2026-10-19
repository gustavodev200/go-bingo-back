import { ArenaController } from './arena.controller';
import type { ArenaService } from './arena.service';

describe('ArenaController', () => {
  it('latest() passes the caller and the optional since date to the service', async () => {
    const result = { matchId: 'm1' };
    const arena = { latest: jest.fn().mockResolvedValue(result) };
    const controller = new ArenaController(arena as unknown as ArenaService);
    const user = { id: 'u1', isAnonymous: false };

    await expect(
      controller.latest(user, { since: '2026-10-19T12:00:00.000Z' }),
    ).resolves.toEqual({ result, now: expect.any(String) as unknown });
    expect(arena.latest).toHaveBeenCalledWith(
      'u1',
      new Date('2026-10-19T12:00:00.000Z'),
    );

    await controller.latest(user, {});
    expect(arena.latest).toHaveBeenLastCalledWith('u1', undefined);
  });
});

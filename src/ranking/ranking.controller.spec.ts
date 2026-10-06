import type { AuthUser } from '../core/auth/jwt-verifier';
import { RankingController } from './ranking.controller';
import type { RankingService } from './ranking.service';

describe('RankingController', () => {
  it('list() delegates to the service with the viewer id and cursor', () => {
    const response = { entries: [], me: null, nextCursor: null };
    const ranking = { list: jest.fn().mockResolvedValue(response) };
    const controller = new RankingController(
      ranking as unknown as RankingService,
    );
    const user: AuthUser = { id: 'u1', isAnonymous: false };

    const result = controller.list(user, { cursor: 50 });

    expect(ranking.list).toHaveBeenCalledWith('u1', 50);
    return expect(result).resolves.toBe(response);
  });
});

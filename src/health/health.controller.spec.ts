import type { PrismaService } from '../core/prisma.service';
import { HealthController } from './health.controller';

const withQuery = (queryRaw: jest.Mock) =>
  new HealthController({ $queryRaw: queryRaw } as unknown as PrismaService);

describe('HealthController', () => {
  it('reports ok and the latest applied migration', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValue([
        { migration_name: '20261011000000_profile_character' },
      ]);
    await expect(withQuery(queryRaw).check()).resolves.toEqual({
      status: 'ok',
      schema: '20261011000000_profile_character',
    });
  });

  it('stays ok (schema null) when the database does not answer, so the host does not restart the service', async () => {
    const queryRaw = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(withQuery(queryRaw).check()).resolves.toEqual({
      status: 'ok',
      schema: null,
    });
  });
});

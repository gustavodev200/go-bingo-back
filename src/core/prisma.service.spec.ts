import type { Env } from './env';
import { PrismaService } from './prisma.service';

const env: Pick<Env, 'DATABASE_URL'> = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
};

describe('PrismaService', () => {
  it('disconnects the underlying client on module destroy', async () => {
    const service = new PrismaService(env as Env);
    const disconnect = jest
      .spyOn(service, '$disconnect')
      .mockResolvedValue(undefined);

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

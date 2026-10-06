import * as Sentry from '@sentry/nestjs';
import type { PrismaService } from '../core/prisma.service';
import { GuestCleanupService, GUEST_TTL_MS } from './guest-cleanup.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

function make(authExists: boolean) {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ exists: authExists }]),
    $executeRaw: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(2),
  };
  return {
    prisma,
    service: new GuestCleanupService(prisma as unknown as PrismaService),
  };
}

describe('GuestCleanupService', () => {
  it('sem schema auth (Postgres local) não faz nada', async () => {
    const { prisma, service } = make(false);
    await expect(service.cleanup()).resolves.toEqual({
      authUsers: 0,
      profiles: 0,
    });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('apaga anônimos sem sessão recente e depois os perfis órfãos', async () => {
    const { prisma, service } = make(true);
    const now = new Date('2026-11-01T04:00:00Z');
    await expect(service.cleanup(now)).resolves.toEqual({
      authUsers: 3,
      profiles: 2,
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    const calls = prisma.$executeRaw.mock.calls as unknown[][];
    const cutoff = calls[0][1] as Date;
    expect(cutoff.getTime()).toBe(now.getTime() - GUEST_TTL_MS);
  });

  it('run() registra o resultado e engole erros do cleanup', async () => {
    const { prisma, service } = make(true);
    await expect(service.run()).resolves.toBeUndefined();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);

    const failing = make(true);
    failing.prisma.$queryRaw.mockRejectedValueOnce(new Error('db down'));
    await expect(failing.service.run()).resolves.toBeUndefined();
  });

  it('run() envia a falha do job ao Sentry (cron não tem quem veja o erro)', async () => {
    const failing = make(true);
    const boom = new Error('db down');
    failing.prisma.$queryRaw.mockRejectedValueOnce(boom);
    (Sentry.captureException as jest.Mock).mockClear();
    await failing.service.run();
    expect(Sentry.captureException).toHaveBeenCalledWith(boom);
  });
});

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { JWT_KEY_SET } from '../../src/core/auth/jwt-verifier';
import { loadEnv } from '../../src/core/env';
import { PrismaService } from '../../src/core/prisma.service';
import { createTestAuth } from './auth';

type Override = {
  token: symbol | string | (new (...args: never[]) => unknown);
  value: unknown;
};

export async function createTestApp(overrides: Override[] = []) {
  const env = loadEnv();
  const auth = await createTestAuth(`${env.SUPABASE_URL}/auth/v1`);
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(JWT_KEY_SET)
    .useValue(auth.keySet);
  for (const o of overrides)
    builder = builder.overrideProvider(o.token).useValue(o.value);
  const moduleRef = await builder.compile();

  const app: INestApplication = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer() as Server;
  const { port } = server.address() as AddressInfo;
  const prisma = app.get(PrismaService);

  return {
    app,
    url: `http://127.0.0.1:${port}`,
    auth,
    prisma,
    resetDb: () =>
      prisma.$executeRawUnsafe(
        'TRUNCATE "Draw","Card","Game","RoomMember","Room","Profile" CASCADE',
      ),
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

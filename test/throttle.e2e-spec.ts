import request from 'supertest';
import { ENV, loadEnv } from '../src/core/env';
import { createTestApp, type TestApp } from './support/app';

// Limite global do ThrottlerModule (app.module.ts): 100 req / 60 s por IP.
const LIMIT = 100;
const REAL_IP = '203.0.113.7';

describe('HTTP throttle atrás de proxy (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp([
      { token: ENV, value: { ...loadEnv(), TRUST_PROXY: true } },
    ]);
  });
  afterAll(() => t.app.close());

  it('não deixa o cliente trocar de balde forjando o X-Forwarded-For', async () => {
    // O proxy (Fly) acrescenta o IP real no fim do X-Forwarded-For; o que vem
    // antes foi enviado pelo próprio cliente e não é confiável.
    const statuses: number[] = [];
    for (let i = 0; i <= LIMIT; i++) {
      const res = await request(t.url)
        .get('/health')
        .set(
          'X-Forwarded-For',
          `10.0.${Math.floor(i / 250)}.${i % 250}, ${REAL_IP}`,
        );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, LIMIT).every((s) => s === 200)).toBe(true);
    expect(statuses[LIMIT]).toBe(429);
  });

  it('mantém baldes separados para IPs reais diferentes', async () => {
    await request(t.url)
      .get('/health')
      .set('X-Forwarded-For', '198.51.100.9')
      .expect(200);
  });
});

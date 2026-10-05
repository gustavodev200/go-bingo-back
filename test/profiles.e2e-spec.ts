import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Profile } from '../src/contracts';
import { createTestApp, TestApp } from './support/app';

describe('/me', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.app.close());
  beforeEach(() => t.resetDb());

  it('requires a token', async () => {
    const res = await request(t.url).get('/me').expect(401);
    const body = res.body as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('creates the profile on first access with no nickname', async () => {
    const id = randomUUID();
    const res = await request(t.url)
      .get('/me')
      .set(
        'Authorization',
        `Bearer ${await t.auth.sign(id, { isAnonymous: true })}`,
      )
      .expect(200);
    expect(res.body).toEqual({ id, nickname: null, isGuest: true, points: 0 });
  });

  it('marks the profile as non-guest after the guest links Google', async () => {
    const id = randomUUID();
    await request(t.url)
      .get('/me')
      .set(
        'Authorization',
        `Bearer ${await t.auth.sign(id, { isAnonymous: true })}`,
      );
    const res = await request(t.url)
      .get('/me')
      .set('Authorization', `Bearer ${await t.auth.sign(id)}`)
      .expect(200);
    const body = res.body as Profile;
    expect(body.isGuest).toBe(false);
  });

  it('sets a valid nickname', async () => {
    const token = await t.auth.sign(randomUUID());
    const res = await request(t.url)
      .patch('/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '  Gustavo ' })
      .expect(200);
    const body = res.body as Profile;
    expect(body.nickname).toBe('Gustavo');
  });

  it.each(['ab', '<b>oi</b>', 'caralho'])(
    'rejects nickname %s',
    async (nickname) => {
      const token = await t.auth.sign(randomUUID());
      const res = await request(t.url)
        .patch('/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ nickname });
      expect(res.status).toBe(400);
    },
  );
});

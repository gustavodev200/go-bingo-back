import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  DAILY_COINS,
  profileStatsSchema,
  WELCOME_COINS,
  type Profile,
} from '../src/contracts';
import { createTestApp, TestApp } from './support/app';
import { makeRoom, makeUser } from './support/factories';

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
    // primeiro acesso: boas-vindas + bônus do dia
    expect(res.body).toEqual({
      id,
      nickname: null,
      isGuest: true,
      points: 0,
      coins: WELCOME_COINS + DAILY_COINS,
      dailyBonus: 50,
    });
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

  it('saves the chosen character with the nickname and returns it on GET /me', async () => {
    const token = await t.auth.sign(randomUUID());
    await request(t.url)
      .patch('/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: 'Ana', character: 'c07' })
      .expect(200);
    const res = await request(t.url)
      .get('/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toMatchObject({ nickname: 'Ana', character: 'c07' });
  });

  it.each([{ character: 'c99' }, {}])('rejects patch %j', async (body) => {
    const token = await t.auth.sign(randomUUID());
    const res = await request(t.url)
      .patch('/me')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(400);
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

describe('/me/stats', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.app.close());
  beforeEach(() => t.resetDb());

  it('returns games, wins, points, rank and the coin history', async () => {
    const me = await makeUser(t, 'Ana');
    const other = await makeUser(t, 'Bia');
    await t.prisma.profile.update({
      where: { id: me.id },
      data: { gamesPlayed: 2, points: 20 },
    });
    await t.prisma.profile.update({
      where: { id: other.id },
      data: { gamesPlayed: 1, points: 40 },
    });
    const room = await makeRoom(t, me.id);
    await t.prisma.game.create({
      data: { roomId: room.id, status: 'FINISHED', winnerId: me.id },
    });
    await t.prisma.game.create({
      data: { roomId: room.id, status: 'FINISHED', winnerId: other.id },
    });
    await t.prisma.coinTransaction.createMany({
      data: [
        {
          userId: me.id,
          amount: 1000,
          reason: 'WELCOME',
          createdAt: new Date('2026-10-01T00:00:00Z'),
        },
        {
          userId: me.id,
          amount: -5,
          reason: 'CARD',
          createdAt: new Date('2026-10-02T00:00:00Z'),
        },
        { userId: other.id, amount: 200, reason: 'WIN' },
      ],
    });

    const res = await request(t.url)
      .get('/me/stats')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    const body = profileStatsSchema.parse(res.body);
    expect(body).toMatchObject({
      gamesPlayed: 2,
      wins: 1,
      points: 20,
      rank: 2,
    });
    expect(body.coinHistory.map((c) => c.reason)).toEqual(['CARD', 'WELCOME']);
  });

  it('guests have no rank', async () => {
    const guest = await makeUser(t, 'Convidado', { isAnonymous: true });
    const res = await request(t.url)
      .get('/me/stats')
      .set('Authorization', `Bearer ${guest.token}`)
      .expect(200);
    expect(profileStatsSchema.parse(res.body).rank).toBeNull();
  });

  it('requires a token', async () => {
    await request(t.url).get('/me/stats').expect(401);
  });
});

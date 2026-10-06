import request from 'supertest';
import type { RankingResponse } from '../src/contracts';
import { createTestApp, TestApp } from './support/app';
import { makeUser } from './support/factories';

describe('GET /ranking', () => {
  let t: TestApp;
  beforeAll(async () => (t = await createTestApp()));
  afterAll(() => t.app.close());
  beforeEach(() => t.resetDb());

  async function player(
    nickname: string,
    points: number,
    opts: { guest?: boolean; played?: number } = {},
  ) {
    const u = await makeUser(t, nickname, { isAnonymous: opts.guest });
    await t.prisma.profile.update({
      where: { id: u.id },
      data: { points, gamesPlayed: opts.played ?? 1 },
    });
    return u;
  }

  it('orders by points, excludes guests and players with no games, and locates me', async () => {
    const top = await player('Top', 100);
    const mid = await player('Mid', 40);
    await player('Guest', 999, { guest: true });
    await player('Novato', 0, { played: 0 });

    const res = await request(t.url)
      .get('/ranking')
      .set('Authorization', `Bearer ${mid.token}`)
      .expect(200);

    expect(res.headers['cache-control']).toBe('private, max-age=60');
    expect(res.body).toEqual({
      entries: [
        { rank: 1, userId: top.id, nickname: 'Top', points: 100 },
        { rank: 2, userId: mid.id, nickname: 'Mid', points: 40 },
      ],
      me: { rank: 2, points: 40 },
      nextCursor: null,
    });
  });

  it('returns me = null for guests and paginates', async () => {
    for (let i = 0; i < 51; i++) await player(`P${i}`, i);
    const guest = await player('Convidado', 0, { guest: true });

    const page1 = await request(t.url)
      .get('/ranking')
      .set('Authorization', `Bearer ${guest.token}`)
      .expect(200);
    const body1 = page1.body as RankingResponse;
    expect(body1.entries).toHaveLength(50);
    expect(body1.me).toBeNull();
    expect(body1.nextCursor).toBe(50);

    const page2 = await request(t.url)
      .get('/ranking?cursor=50')
      .set('Authorization', `Bearer ${guest.token}`)
      .expect(200);
    const body2 = page2.body as RankingResponse;
    expect(body2.entries).toEqual([
      expect.objectContaining({ rank: 51, points: 0 }),
    ]);
  });

  it('rejects an invalid cursor', async () => {
    const u = await player('A', 1);
    await request(t.url)
      .get('/ranking?cursor=-1')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(400);
  });
});

import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DEFAULT_DRAW_INTERVAL_MS, type PublicRoom } from '../src/contracts';
import { RANDOM_INT } from '../src/core/random';
import { createTestApp, TestApp } from './support/app';

interface ErrorResponse {
  code: string;
  message: string;
}

interface RoomCreateResponse {
  code: string;
}

describe('/rooms', () => {
  let t: TestApp;
  // Sequência que gera "AAAAAA" duas vezes e depois "BBBBBB": força uma colisão.
  const sequence: number[] = [
    ...Array.from({ length: 12 }, () => 0),
    ...Array.from({ length: 6 }, () => 1),
  ];
  let calls = 0;
  const scriptedRandom = (min: number, max: number): number =>
    calls < sequence.length
      ? sequence[calls++]
      : min + Math.floor(Math.random() * (max - min));

  beforeAll(
    async () =>
      (t = await createTestApp([{ token: RANDOM_INT, value: scriptedRandom }])),
  );
  afterAll(() => t.app.close());
  beforeEach(async () => {
    calls = 0;
    await t.resetDb();
  });

  async function userWithNickname(nickname = 'Host') {
    const token = await t.auth.sign(randomUUID());
    await request(t.url)
      .patch('/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname });
    return token;
  }

  it('requires a nickname to create a room', async () => {
    const token = await t.auth.sign(randomUUID());
    const res = await request(t.url)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Amigos', maxPlayers: 10, isPublic: true });
    expect(res.status).toBe(409);
    expect((res.body as ErrorResponse).code).toBe('NICKNAME_REQUIRED');
  });

  it('creates a room, retrying on code collision, with host in slot 0', async () => {
    const token = await userWithNickname();
    const first = await request(t.url)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Amigos', maxPlayers: 10, isPublic: true })
      .expect(201);
    const second = await request(t.url)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Outra', maxPlayers: 15, isPublic: false })
      .expect(201);

    expect((first.body as RoomCreateResponse).code).toBe('AAAAAA');
    expect((second.body as RoomCreateResponse).code).toBe('BBBBBB');
    const room = await t.prisma.room.findUniqueOrThrow({
      where: { code: 'AAAAAA' },
      include: { members: true },
    });
    expect(room.members).toEqual([
      expect.objectContaining({ slot: 0, userId: room.hostId }),
    ]);
  });

  it('uses the server default draw interval, or the one the host picked within limits', async () => {
    const token = await userWithNickname();
    const send = (body: object) =>
      request(t.url)
        .post('/rooms')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Amigos', maxPlayers: 10, isPublic: true, ...body });

    await send({}).expect(201);
    await send({ drawIntervalMs: 12_000 }).expect(201);
    const tooFast = await send({ drawIntervalMs: 1_000 });
    expect(tooFast.status).toBe(400);

    const rooms = await t.prisma.room.findMany({
      orderBy: { createdAt: 'asc' },
    });
    expect(rooms.map((r) => r.drawIntervalMs)).toEqual([
      DEFAULT_DRAW_INTERVAL_MS,
      12_000,
    ]);
  });

  it('rejects invalid input', async () => {
    const token = await userWithNickname();
    const res = await request(t.url)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'x', maxPlayers: 12, isPublic: 'sim' });
    expect(res.status).toBe(400);
    expect((res.body as ErrorResponse).code).toBe('INVALID_PAYLOAD');
  });

  it('lists only public waiting rooms with player count', async () => {
    const token = await userWithNickname();
    await request(t.url)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Publica', maxPlayers: 10, isPublic: true });
    await request(t.url)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Privada', maxPlayers: 10, isPublic: false });

    const res = await request(t.url)
      .get('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body as PublicRoom[]).toEqual([
      {
        code: 'AAAAAA',
        name: 'Publica',
        playerCount: 1,
        maxPlayers: 10,
        status: 'WAITING',
      },
    ]);
  });

  it('returns a summary by code (case-insensitive) or 404', async () => {
    const token = await userWithNickname();
    await request(t.url)
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Privada', maxPlayers: 25, isPublic: false });

    const ok = await request(t.url)
      .get('/rooms/aaaaaa')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((ok.body as PublicRoom).name).toBe('Privada');
    const missing = await request(t.url)
      .get('/rooms/ZZZZZZ')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(missing.body as ErrorResponse).toEqual({
      code: 'NOT_FOUND',
      message: 'Sala não encontrada',
    });
  });
});

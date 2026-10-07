import type { Socket } from 'socket.io-client';
import { DRAW_TIMER, type DrawTimer } from '../src/game/draw-timer';
import { GameRunner } from '../src/game/game-runner.service';
import { GamesService } from '../src/game/games.service';
import { MembershipService } from '../src/game/membership.service';
import { PresenceService } from '../src/game/presence.service';
import { createTestApp, TestApp } from './support/app';
import { makeRoom, makeUser } from './support/factories';
import { ack, connect, next } from './support/socket';

describe('GameGateway', () => {
  let t: TestApp;
  const timer: DrawTimer = { set: () => null, clear: () => undefined };
  const sockets: Socket[] = [];

  beforeAll(
    async () =>
      (t = await createTestApp([{ token: DRAW_TIMER, value: timer }])),
  );
  afterAll(() => t.app.close());
  beforeEach(() => t.resetDb());
  afterEach(() => {
    sockets.splice(0).forEach((s) => s.close());
  });

  async function client(token: string) {
    const s = await connect(t.url, token);
    sockets.push(s);
    return s;
  }

  async function roomWithTwo() {
    const host = await makeUser(t, 'Host');
    const ana = await makeUser(t, 'Ana');
    const room = await makeRoom(t, host.id);
    const hs = await client(host.token);
    const as = await client(ana.token);
    await ack(hs, 'room:join', { code: room.code });
    const joined = next(hs, 'room:member_joined');
    await ack(as, 'room:join', { code: room.code });
    await joined;
    return { host, ana, room, hs, as };
  }

  it('rejects connections without a valid token', async () => {
    await expect(connect(t.url, undefined)).rejects.toThrow('UNAUTHENTICATED');
    await expect(connect(t.url, 'garbage')).rejects.toThrow('UNAUTHENTICATED');
  });

  it('joins with a snapshot and notifies others', async () => {
    const host = await makeUser(t, 'Host');
    const ana = await makeUser(t, 'Ana');
    const room = await makeRoom(t, host.id);
    const hs = await client(host.token);
    const as = await client(ana.token);

    await ack(hs, 'room:join', { code: room.code });
    const joined = next<{ member: { nickname: string }; reconnected: boolean }>(
      hs,
      'room:member_joined',
    );
    const res = await ack<{
      ok: true;
      data: { members: unknown[]; myCard: null; status: string };
    }>(as, 'room:join', { code: room.code.toLowerCase() });

    expect(res.ok).toBe(true);
    expect(res.data.members).toHaveLength(2);
    expect(res.data.status).toBe('WAITING');
    await expect(joined).resolves.toMatchObject({
      member: { nickname: 'Ana' },
      reconnected: false,
    });
  });

  it('rejects malformed payloads and unknown rooms', async () => {
    const u = await makeUser(t, 'Ana');
    const s = await client(u.token);
    await expect(ack(s, 'room:join', { code: 123 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
    await expect(
      ack(s, 'room:join', { code: 'ZZZZZZ' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    await expect(ack(s, 'card:generate')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_IN_ROOM' },
    });
  });

  it('rate limits floods', async () => {
    const u = await makeUser(t, 'Ana');
    const s = await client(u.token);
    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        ack<{ ok: boolean; error?: { code: string } }>(s, 'rooms:watch'),
      ),
    );
    expect(
      results.filter((r) => !r.ok && r.error?.code === 'RATE_LIMITED').length,
    ).toBeGreaterThanOrEqual(5);
  });

  it('plays a full round: cards, start, draws, invalid then valid bingo', async () => {
    const { host, ana, room, hs, as } = await roomWithTwo();
    const ready = next<{ userId: string }>(hs, 'room:member_ready');
    await ack(as, 'card:generate');
    await expect(ready).resolves.toEqual({ userId: ana.id });
    await ack(hs, 'card:generate');

    await expect(ack(as, 'game:start')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_HOST' },
    });
    const state = next<{ status: string; myCard: { grid: number[] } }>(
      as,
      'room:state',
    );
    await expect(ack(hs, 'game:start')).resolves.toEqual({
      ok: true,
      data: null,
    });
    const snapshot = await state;
    expect(snapshot.status).toBe('IN_GAME');

    await expect(ack(as, 'bingo:claim')).resolves.toMatchObject({
      ok: false,
      error: { code: 'BINGO_INVALID' },
    });

    const runner = t.app.get(GameRunner);
    const [{ id: gameId }] = await t.app.get(GamesService).findInProgress();
    const drawnEvent = next<{ seq: number; letter: string }>(
      as,
      'game:number_drawn',
    );
    await runner.tick(gameId, room.code, 5000);
    await expect(drawnEvent).resolves.toMatchObject({ seq: 1 });

    // Sorteia o resto direto no banco para completar a cartela da Ana.
    const drawn = new Set(await t.app.get(GamesService).drawnNumbers(gameId));
    let seq = drawn.size;
    for (const n of snapshot.myCard.grid) {
      if (n !== 0 && !drawn.has(n)) {
        await t.prisma.draw.create({ data: { gameId, seq: ++seq, number: n } });
        drawn.add(n);
      }
    }
    await t.prisma.game.update({
      where: { id: gameId },
      data: { drawnCount: seq },
    });

    await new Promise((r) => setTimeout(r, 2100)); // janela do rate limit de claim
    const won = next<{ userId: string; pointsAwarded: number }>(hs, 'game:won');
    const res = await ack<{ ok: true; data: { userId: string } }>(
      as,
      'bingo:claim',
    );
    expect(res).toMatchObject({
      ok: true,
      data: { userId: ana.id, pointsAwarded: 20 },
    });
    await expect(won).resolves.toMatchObject({ userId: ana.id });
    expect(
      (await t.prisma.profile.findUniqueOrThrow({ where: { id: ana.id } }))
        .points,
    ).toBe(20);
    expect(
      (await t.prisma.profile.findUniqueOrThrow({ where: { id: host.id } }))
        .points,
    ).toBe(0);
  });

  it('marks only drawn numbers', async () => {
    const { hs, as } = await roomWithTwo();
    await ack(as, 'card:generate');
    await ack(hs, 'card:generate');
    const state = next<{ myCard: { grid: number[] } }>(as, 'room:state');
    await ack(hs, 'game:start');
    const { myCard } = await state;
    await expect(ack(as, 'card:mark', { index: 0 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_DRAWN' },
    });

    const [{ id: gameId }] = await t.app.get(GamesService).findInProgress();
    await t.prisma.draw.create({
      data: { gameId, seq: 1, number: myCard.grid[0] },
    });
    await expect(ack(as, 'card:mark', { index: 0 })).resolves.toEqual({
      ok: true,
      data: { marked: [0] },
    });
    await expect(ack(as, 'card:mark', { index: 25 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
  });

  it('reconnect within grace keeps the card and marks; others see disconnected then back', async () => {
    const { ana, room, hs, as } = await roomWithTwo();
    await ack(as, 'card:generate');

    const left = next<{ userId: string; reason: string }>(
      hs,
      'room:member_left',
    );
    as.close();
    await expect(left).resolves.toEqual({
      userId: ana.id,
      reason: 'disconnected',
    });

    const back = next<{ reconnected: boolean }>(hs, 'room:member_joined');
    const as2 = await client(ana.token);
    const res = await ack<{
      ok: true;
      data: {
        myCard: unknown;
        members: Array<{ userId: string; slot: number; connected: boolean }>;
      };
    }>(as2, 'room:join', { code: room.code });
    await expect(back).resolves.toMatchObject({ reconnected: true });
    expect(res.data.myCard).not.toBeNull();
    expect(res.data.members.find((m) => m.userId === ana.id)).toMatchObject({
      slot: 1,
      connected: true,
    });
  });

  it('expiry transfers host and notifies the room', async () => {
    const { host, ana, room, hs, as } = await roomWithTwo();
    const presence = t.app.get(PresenceService);
    const changed = next<{ hostId: string }>(as, 'room:host_changed');
    const left = next<{ reason: string }>(as, 'room:member_left');
    hs.close();
    await left;
    // Simula o fim da janela de 60 s chamando o handler de expiração registrado pelo gateway.
    (
      presence as unknown as { onExpired: (c: string, u: string) => void }
    ).onExpired(room.code, host.id);
    await expect(changed).resolves.toEqual({ hostId: ana.id });
  });

  it('kick removes the player and cancel closes the room', async () => {
    const { ana, room, hs, as } = await roomWithTwo();
    const kicked = next<{ userId: string; reason: string }>(
      as,
      'room:member_left',
    );
    await expect(ack(hs, 'room:kick', { userId: ana.id })).resolves.toEqual({
      ok: true,
      data: null,
    });
    await expect(kicked).resolves.toEqual({ userId: ana.id, reason: 'kicked' });

    await expect(ack(hs, 'room:cancel')).resolves.toEqual({
      ok: true,
      data: null,
    });
    expect(
      (await t.prisma.room.findUniqueOrThrow({ where: { code: room.code } }))
        .status,
    ).toBe('CLOSED');
  });

  it('rooms:watch returns the list and pushes updates', async () => {
    const host = await makeUser(t, 'Host');
    const viewer = await makeUser(t, 'Ver');
    const room = await makeRoom(t, host.id);
    const vs = await client(viewer.token);
    const list = await ack<{
      ok: true;
      data: Array<{ code: string; playerCount: number }>;
    }>(vs, 'rooms:watch');
    expect(list.data).toEqual([
      expect.objectContaining({ code: room.code, playerCount: 1 }),
    ]);

    // O debounce pode emitir um estado intermediário (1 jogador); espera o que tem 2.
    const update = next<{ rooms: Array<{ playerCount: number }> }>(
      vs,
      'rooms:updated',
      3000,
      (p) => p.rooms[0]?.playerCount === 2,
    );
    const hs = await client(host.token);
    const ana = await makeUser(t, 'Ana');
    const as = await client(ana.token);
    await ack(hs, 'room:join', { code: room.code });
    await ack(as, 'room:join', { code: room.code });
    await expect(update).resolves.toMatchObject({
      rooms: [expect.objectContaining({ playerCount: 2 })],
    });
  });

  it('lets a member immediately join a different room after the host cancels', async () => {
    const { ana, hs, as } = await roomWithTwo();
    const host2 = await makeUser(t, 'Host2');
    const room2 = await makeRoom(t, host2.id);

    await expect(ack(hs, 'room:cancel')).resolves.toEqual({
      ok: true,
      data: null,
    });

    // Sem o fix: a rejeição fica travada em INVALID_STATE porque o socket da
    // Ana ainda guarda o roomCode da sala 1, mesmo tendo sido removido do
    // canal pelo closeRoomChannel(). Ela precisa poder entrar na sala 2 sem
    // precisar emitir room:leave antes.
    const res = await ack<{ ok: boolean; data?: { code: string } }>(
      as,
      'room:join',
      { code: room2.code },
    );
    expect(res).toMatchObject({ ok: true, data: { code: room2.code } });

    // membership.cancel() só fecha a sala 1 (status CLOSED); não apaga o
    // RoomMember antigo. O que importa aqui é que a entrada na sala 2
    // realmente criou a nova membership — o que confirma que o room:join
    // não foi bloqueado por um roomCode "fantasma" da sala cancelada.
    const room2Id = (
      await t.prisma.room.findUniqueOrThrow({ where: { code: room2.code } })
    ).id;
    const membership = await t.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room2Id, userId: ana.id } },
    });
    expect(membership).not.toBeNull();
  });

  it('lets a kicked player immediately join a different room', async () => {
    const { ana, hs, as } = await roomWithTwo();
    const host2 = await makeUser(t, 'Host2');
    const room2 = await makeRoom(t, host2.id);

    await expect(ack(hs, 'room:kick', { userId: ana.id })).resolves.toEqual({
      ok: true,
      data: null,
    });

    const res = await ack<{ ok: boolean; data?: { code: string } }>(
      as,
      'room:join',
      { code: room2.code },
    );
    expect(res).toMatchObject({ ok: true, data: { code: room2.code } });
  });

  it('rejects a concurrent room:join to a different room on the same socket', async () => {
    const hostA = await makeUser(t, 'HostA');
    const hostB = await makeUser(t, 'HostB');
    const ana = await makeUser(t, 'Ana');
    const roomA = await makeRoom(t, hostA.id);
    const roomB = await makeRoom(t, hostB.id);
    const s = await client(ana.token);

    const [resA, resB] = await Promise.all([
      ack<{ ok: boolean; error?: { code: string } }>(s, 'room:join', {
        code: roomA.code,
      }),
      ack<{ ok: boolean; error?: { code: string } }>(s, 'room:join', {
        code: roomB.code,
      }),
    ]);

    const results = [resA, resB];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      results.some((r) => !r.ok && r.error?.code === 'INVALID_STATE'),
    ).toBe(true);

    const memberships = await t.prisma.roomMember.findMany({
      where: { userId: ana.id },
    });
    expect(memberships).toHaveLength(1);
  });

  it('does not create a ghost presence entry when the socket disconnects mid-join', async () => {
    const host = await makeUser(t, 'Host');
    const ana = await makeUser(t, 'Ana');
    const room = await makeRoom(t, host.id);
    const membership = t.app.get(MembershipService);

    let signalReached: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => (signalReached = resolve));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let signalDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => (signalDone = resolve));
    const original = membership.join.bind(membership);
    const spy = jest
      .spyOn(membership, 'join')
      .mockImplementation(async (code: string, userId: string) => {
        signalReached();
        await gate;
        try {
          return await original(code, userId);
        } finally {
          signalDone();
        }
      });

    try {
      const s = await client(ana.token);
      const joinAck = ack(s, 'room:join', { code: room.code }).catch(
        () => undefined,
      );
      await reached; // o handler já entrou em membership.join() e está preso no gate
      s.close();
      await new Promise((r) => setTimeout(r, 150)); // dá tempo do handleDisconnect rodar no socket já morto
      release();
      // Espera o membership.join() real (que a troca acima destravou) terminar
      // de fato no servidor, não só a rejeição local do ack no cliente —
      // senão o teste termina (e o afterAll fecha o app) enquanto o handler
      // ainda está no meio de awaits no servidor.
      await done;
      await joinAck;
      await new Promise((r) => setTimeout(r, 50)); // deixa o handler terminar o resto da cadeia síncrona após o join
    } finally {
      spy.mockRestore();
    }

    const presence = t.app.get(PresenceService);
    expect(presence.connectedSet(room.code).has(ana.id)).toBe(false);
  });

  it('broadcasts emotes to everyone in the room, sender included', async () => {
    const { host, hs, as } = await roomWithTwo();
    const seenByAna = next<{ userId: string; emote: string }>(
      as,
      'room:emoted',
    );
    const seenByHost = next<{ userId: string; emote: string }>(
      hs,
      'room:emoted',
    );

    await expect(ack(hs, 'room:emote', { emote: 'fire' })).resolves.toEqual({
      ok: true,
      data: null,
    });

    await expect(seenByAna).resolves.toEqual({
      userId: host.id,
      emote: 'fire',
    });
    await expect(seenByHost).resolves.toEqual({
      userId: host.id,
      emote: 'fire',
    });
  });

  it('a late joiner watches as spectator and is told when every player left', async () => {
    const { room, hs, as } = await roomWithTwo();
    await ack(hs, 'card:generate');
    await ack(as, 'card:generate');
    await expect(ack(hs, 'game:start')).resolves.toMatchObject({ ok: true });

    const bia = await makeUser(t, 'Bia');
    const bs = await client(bia.token);
    const joined = await ack<{
      ok: true;
      data: { status: string; myCard: null; members: unknown[] };
    }>(bs, 'room:join', { code: room.code });
    expect(joined.ok).toBe(true);
    expect(joined.data.status).toBe('IN_GAME');
    expect(joined.data.myCard).toBeNull();
    expect(joined.data.members).toHaveLength(3);

    await ack(as, 'room:leave');
    const ended = next<{ reason: string }>(bs, 'game:ended');
    await ack(hs, 'room:leave');
    await expect(ended).resolves.toEqual({ reason: 'no_players' });
  });
});

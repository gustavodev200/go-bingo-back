import { ArenaService } from '../arena/arena.service';
import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  TrucoPrivateHand,
  TrucoRoomState,
  TrucoSnapshot,
} from '../contracts';
import { JwtVerifier } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { cryptoRandomInt, RANDOM_INT } from '../core/random';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ProfilesService } from '../profiles/profiles.service';
import { SocketTrucoPublisher, TRUCO_PUBLISHER } from './truco-publisher';
import { TRUCO_CONFIG, TrucoRoomsService } from './truco-rooms.service';
import { TrucoGateway } from './truco.gateway';

/**
 * Multiplayer integration: a real Nest app with the real gateway and four
 * real Socket.IO clients. Auth and profiles are stubbed so it runs without a database.
 */
const NAMES: Record<string, string | null> = {
  u0: 'Ana',
  u1: 'Bia',
  u2: 'Caio',
  u3: 'Duda',
  u4: 'Edu',
  nonick: null,
};
const GRACE_MS = 1_000;

interface Client {
  userId: string;
  socket: Socket;
  events: { event: string; payload: unknown }[];
}

describe('TrucoGateway (Socket.IO integration)', () => {
  let app: INestApplication;
  let url: string;
  let clients: Client[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TrucoGateway,
        TrucoRoomsService,
        {
          provide: ArenaService,
          useValue: {
            settleSafe: jest.fn().mockResolvedValue(null),
            assertStake: jest.fn().mockResolvedValue(undefined),
          },
        },
        SocketTrucoPublisher,
        { provide: TRUCO_PUBLISHER, useExisting: SocketTrucoPublisher },
        {
          provide: TRUCO_CONFIG,
          useValue: {
            reconnectGraceMs: GRACE_MS,
            handPauseMs: 50,
            maxRooms: 50,
          },
        },
        { provide: RANDOM_INT, useValue: cryptoRandomInt },
        { provide: DRAW_TIMER, useValue: realDrawTimer },
        {
          provide: JwtVerifier,
          useValue: {
            verify: (token: string) =>
              token.startsWith('ok:')
                ? Promise.resolve({ id: token.slice(3), isAnonymous: false })
                : Promise.reject(new DomainError('UNAUTHENTICATED', 'no')),
          },
        },
        {
          provide: ProfilesService,
          useValue: {
            ensure: (u: { id: string }) =>
              Promise.resolve({ nickname: NAMES[u.id], character: 'c01' }),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0, '127.0.0.1');
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${port}/truco`;
  });

  afterEach(async () => {
    // Leave explicitly: a plain disconnect would keep the seat reserved for the next test.
    await Promise.all(
      clients
        .filter((c) => c.socket.connected)
        .map((c) => emit(c, 'truco:leave').catch(() => undefined)),
    );
    clients.forEach((c) => c.socket.close());
    clients = [];
  });

  afterAll(() => app.close());

  function connect(userId: string, token = `ok:${userId}`): Promise<Client> {
    const socket = io(url, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    const client: Client = { userId, socket, events: [] };
    socket.onAny((event: string, payload: unknown) =>
      client.events.push({ event, payload }),
    );
    return new Promise((resolve, reject) => {
      socket.once('connect', () => {
        clients.push(client);
        resolve(client);
      });
      socket.once('connect_error', (error) => {
        socket.close();
        reject(error);
      });
    });
  }

  function emit<T>(c: Client, event: string, payload: unknown = {}) {
    return c.socket.timeout(3000).emitWithAck(event, payload) as Promise<
      Ack<T>
    >;
  }

  async function ok<T>(c: Client, event: string, payload: unknown = {}) {
    const res = await emit<T>(c, event, payload);
    if (!res.ok) throw new Error(`${event}: ${res.error.code}`);
    return res.data;
  }

  /** Resolves once `c` received `event` (optionally matching), counting from now or from `since`. */
  function waitFor<T>(
    c: Client,
    event: string,
    match: (p: T) => boolean = () => true,
    since = c.events.length,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const hit = c.events
          .slice(since)
          .find((e) => e.event === event && match(e.payload as T));
        if (hit) return resolve(hit.payload as T);
        if (Date.now() - started > 3000)
          return reject(new Error(`timeout waiting ${event} on ${c.userId}`));
        setTimeout(tick, 10);
      };
      tick();
    });
  }

  const latestState = (c: Client) =>
    [...c.events].reverse().find((e) => e.event === 'truco:state')!
      .payload as TrucoRoomState;
  const latestHand = (c: Client) =>
    [...c.events].reverse().find((e) => e.event === 'truco:private_hand')
      ?.payload as TrucoPrivateHand | undefined;

  async function table() {
    const four = await Promise.all(
      ['u0', 'u1', 'u2', 'u3'].map((u) => connect(u)),
    );
    const created = await ok<TrucoSnapshot>(four[0], 'truco:create');
    const code = created.state.code;
    for (const c of four.slice(1)) await ok(c, 'truco:join', { code });
    return { four, code };
  }

  async function startedTable() {
    const t = await table();
    for (const c of t.four) await ok(c, 'truco:ready', { ready: true });
    const versionBefore = latestState(t.four[3]).version;
    await ok(t.four[0], 'truco:start');
    await Promise.all(
      t.four.map((c) =>
        waitFor<TrucoPrivateHand>(c, 'truco:private_hand', () => true, 0),
      ),
    );
    await Promise.all(
      t.four.map((c) =>
        waitFor<TrucoRoomState>(
          c,
          'truco:state',
          (s) => s.phase === 'PLAYING' && s.version > versionBefore,
          0,
        ),
      ),
    );
    return t;
  }

  it('rejects sockets without a valid token', async () => {
    await expect(connect('x', 'garbage')).rejects.toThrow('UNAUTHENTICATED');
  });

  it('requires a nickname before sitting at a table', async () => {
    const c = await connect('nonick');
    await expect(emit(c, 'truco:create')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NICKNAME_REQUIRED' },
    });
  });

  it('creates a room, seats four players with alternating teams and blocks the fifth', async () => {
    const { four, code } = await table();
    const state = await waitFor<TrucoRoomState>(
      four[0],
      'truco:state',
      (s) => s.seats.every(Boolean),
      0,
    );
    expect(state.seats.map((s) => [s!.nickname, s!.team])).toEqual([
      ['Ana', 0],
      ['Bia', 1],
      ['Caio', 0],
      ['Duda', 1],
    ]);
    const fifth = await connect('u4');
    await expect(emit(fifth, 'truco:join', { code })).resolves.toMatchObject({
      ok: false,
      error: { code: 'ROOM_FULL' },
    });
    await expect(
      emit(fifth, 'truco:join', { code: 'ZZZZZZ' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    await expect(
      emit(fifth, 'truco:join', { code: 42 }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
  });

  it('lists public tables live and never private ones', async () => {
    const [watcher, a, b] = await Promise.all([
      connect('u4'),
      connect('u0'),
      connect('u1'),
    ]);
    await expect(ok(watcher, 'truco:watch_rooms')).resolves.toEqual([]);
    const pub = await ok<TrucoSnapshot>(a, 'truco:create', { isPublic: true });
    await ok(b, 'truco:create', { isPublic: false });
    const update = await waitFor<{
      rooms: { code: string; players: number }[];
    }>(watcher, 'truco:rooms_updated', (p) => p.rooms.length > 0);
    expect(update.rooms).toEqual([
      expect.objectContaining({
        code: pub.state.code,
        hostNickname: 'Ana',
        players: 1,
      }),
    ]);
    // The host hides it: the list empties.
    await ok(a, 'truco:set_visibility', { isPublic: false });
    await expect(
      waitFor<{ rooms: unknown[] }>(
        watcher,
        'truco:rooms_updated',
        (p) => p.rooms.length === 0,
      ),
    ).resolves.toEqual({ rooms: [] });
    await expect(
      emit(watcher, 'truco:create', { isPublic: 'yes' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    await ok(watcher, 'truco:unwatch_rooms');
  });

  it('does not start with fewer than four players', async () => {
    const [a, b] = await Promise.all([connect('u0'), connect('u1')]);
    const { state } = await ok<TrucoSnapshot>(a, 'truco:create');
    await ok(b, 'truco:join', { code: state.code });
    await ok(a, 'truco:ready', { ready: true });
    await ok(b, 'truco:ready', { ready: true });
    await expect(emit(a, 'truco:start')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_ENOUGH_PLAYERS' },
    });
  });

  it('keeps every hand private: nobody receives the cards of somebody else', async () => {
    const { four } = await startedTable();
    const hands = four.map((c) => latestHand(c)!);
    hands.forEach((h) => expect(h.cards).toHaveLength(3));
    const allCards = hands.flatMap((h) =>
      h.cards.map((x) => `${x.card!.rank}-${x.card!.suit}`),
    );
    expect(new Set(allCards).size).toBe(12);
    four.forEach((c, i) => {
      const received = JSON.stringify(c.events);
      hands.forEach((h, j) => {
        if (i === j) return;
        for (const x of h.cards) expect(received).not.toContain(`"${x.id}"`);
      });
    });
    // Public states carry counts only, never cards in hand.
    expect(latestState(four[1]).match!.cardsLeft).toEqual([3, 3, 3, 3]);
  });

  it('enforces turn order and ignores a duplicated action', async () => {
    const { four } = await startedTable();
    const turn = latestState(four[0]).match!.turn;
    const current = four[turn];
    const other = four[(turn + 1) % 4];
    await expect(
      emit(other, 'truco:play_card', {
        actionId: 'other-action-1',
        cardId: latestHand(other)!.cards[0].id,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });

    const payload = {
      actionId: 'dup-action-1',
      cardId: latestHand(current)!.cards[0].id,
    };
    const since = four[2].events.length;
    const [first, second] = await Promise.all([
      emit(current, 'truco:play_card', payload),
      emit(current, 'truco:play_card', payload),
    ]);
    expect(first).toEqual({ ok: true, data: null });
    expect(second).toEqual(first);
    await waitFor(four[2], 'truco:card_played', () => true, since);
    await new Promise((r) => setTimeout(r, 100));
    expect(
      four[2].events
        .slice(since)
        .filter((e) => e.event === 'truco:card_played'),
    ).toHaveLength(1);
    // A new actionId with the same (already played) card is a different, invalid move.
    await expect(
      emit(current, 'truco:play_card', {
        ...payload,
        actionId: 'dup-action-2',
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it('syncs a truco request, the answer and the score to all four players', async () => {
    const { four } = await startedTable();
    const turn = latestState(four[0]).match!.turn;
    const marks = four.map((c) => c.events.length);
    await ok(four[turn], 'truco:request_bet', { actionId: 'bet-0001' });
    const requested = await Promise.all(
      four.map((c, i) =>
        waitFor<{ seq: number; value: number }>(
          c,
          'truco:bet_requested',
          () => true,
          marks[i],
        ),
      ),
    );
    expect(new Set(requested.map((r) => r.seq)).size).toBe(1);
    expect(requested[0].value).toBe(3);

    // Own team cannot answer; the opponent team votes to run.
    await expect(
      emit(four[(turn + 2) % 4], 'truco:respond_bet', {
        actionId: 'resp-0001',
        response: 'accept',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_MOVE' } });
    await ok(four[(turn + 1) % 4], 'truco:respond_bet', {
      actionId: 'resp-0002',
      response: 'run',
    });
    await ok(four[(turn + 3) % 4], 'truco:respond_bet', {
      actionId: 'resp-0003',
      response: 'run',
    });
    const scores = await Promise.all(
      four.map((c, i) =>
        waitFor<{ scores: [number, number] }>(
          c,
          'truco:score_updated',
          () => true,
          marks[i],
        ),
      ),
    );
    const expected: [number, number] = turn % 2 === 0 ? [1, 0] : [0, 1];
    scores.forEach((s) => expect(s.scores).toEqual(expected));
    // The next hand is dealt automatically after the pause.
    await Promise.all(
      four.map((c, i) =>
        waitFor<TrucoRoomState>(
          c,
          'truco:state',
          (s) => s.match?.handNumber === 2,
          marks[i],
        ),
      ),
    );
  });

  it('delivers a secret signal only to the partner', async () => {
    const { four } = await startedTable();
    const marks = four.map((c) => c.events.length);
    await ok(four[0], 'truco:signal', { gesture: 'wink' });
    await expect(
      waitFor(four[2], 'truco:signal_received', () => true, marks[2]),
    ).resolves.toEqual({ fromSeat: 0, gesture: 'wink' });
    for (const i of [1, 3])
      await expect(
        waitFor(four[i], 'truco:gestured', () => true, marks[i]),
      ).resolves.toEqual({ seat: 0 });
    await new Promise((r) => setTimeout(r, 100));
    four.forEach((c, i) => {
      const fresh = JSON.stringify(c.events.slice(marks[i]));
      if (i !== 2) expect(fresh).not.toContain('wink');
    });
    expect(
      four[0].events.slice(marks[0]).some((e) => e.event.includes('signal')),
    ).toBe(false);
    await expect(
      emit(four[0], 'truco:signal', { gesture: 'wink' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });

  it('reconnects the same player to the same seat and hand', async () => {
    const { four, code } = await startedTable();
    const bia = four[1];
    const handBefore = latestHand(bia)!;
    const mark = four[0].events.length;
    bia.socket.close();
    await expect(
      waitFor(four[0], 'truco:player_disconnected', () => true, mark),
    ).resolves.toMatchObject({ seat: 1 });
    expect(latestState(four[0]).seats[1]!.connected).toBe(false);

    const back = await connect('u1');
    const snap = await ok<TrucoSnapshot>(back, 'truco:join', { code });
    expect(snap.mySeat).toBe(1);
    expect(snap.hand).toEqual(handBefore);
    expect(snap.state.phase).toBe('PLAYING');
    expect(snap.state.seats[1]!.connected).toBe(true);
    await expect(
      waitFor(four[0], 'truco:player_reconnected', () => true, mark),
    ).resolves.toMatchObject({ seat: 1 });
    await expect(ok<TrucoSnapshot>(back, 'truco:sync')).resolves.toMatchObject({
      mySeat: 1,
    });
  });

  it('ends the match by walkover when the reconnection window expires', async () => {
    const { four } = await startedTable();
    const mark = four[0].events.length;
    four[3].socket.close();
    // waitFor polls for 3 s, longer than the 1 s reconnection window.
    const over = await waitFor<{ winnerTeam: number; reason: string }>(
      four[0],
      'truco:match_over',
      () => true,
      mark,
    );
    expect(over).toMatchObject({ winnerTeam: 0, reason: 'abandoned' });
    expect(latestState(four[0]).seats[3]).toBeNull();
    await ok(four[0], 'truco:rematch');
    await expect(
      waitFor<TrucoRoomState>(
        four[2],
        'truco:state',
        (s) => s.phase === 'LOBBY',
        mark,
      ),
    ).resolves.toMatchObject({ phase: 'LOBBY' });
  });
});

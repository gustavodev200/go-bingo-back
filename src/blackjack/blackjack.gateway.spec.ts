import { ArenaService } from '../arena/arena.service';
import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import type { Ack, BjRoomState, BjSnapshot } from '../contracts';
import { JwtVerifier } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { cryptoRandomInt, RANDOM_INT } from '../core/random';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ProfilesService } from '../profiles/profiles.service';
import { SocketBjPublisher, BJ_PUBLISHER } from './blackjack-publisher';
import { BJ_CONFIG, BjRoomsService } from './blackjack-rooms.service';
import { BjGateway } from './blackjack.gateway';

/**
 * Multiplayer integration: a real Nest app with the real gateway and real Socket.IO clients. Auth and profiles are stubbed so it runs without a database.
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

describe('BjGateway (Socket.IO integration)', () => {
  let app: INestApplication;
  let url: string;
  let clients: Client[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BjGateway,
        BjRoomsService,
        {
          provide: ArenaService,
          useValue: {
            settleSafe: jest.fn().mockResolvedValue(null),
            assertStake: jest.fn().mockResolvedValue(undefined),
          },
        },
        SocketBjPublisher,
        { provide: BJ_PUBLISHER, useExisting: SocketBjPublisher },
        {
          provide: BJ_CONFIG,
          useValue: {
            reconnectGraceMs: GRACE_MS,
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
    url = `http://127.0.0.1:${port}/blackjack`;
  });

  afterEach(async () => {
    // Leave explicitly: a plain disconnect would keep the seat reserved for the next test.
    await Promise.all(
      clients
        .filter((c) => c.socket.connected)
        .map((c) => emit(c, 'blackjack:leave').catch(() => undefined)),
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

  async function startedTable() {
    const two = await Promise.all(['u0', 'u1'].map((u) => connect(u)));
    const created = await ok<BjSnapshot>(two[0], 'blackjack:create');
    const code = created.state.code;
    await ok(two[1], 'blackjack:join', { code });
    for (const c of two) await ok(c, 'blackjack:ready', { ready: true });
    await ok(two[0], 'blackjack:start');
    await Promise.all(
      two.map((c) =>
        waitFor<BjRoomState>(
          c,
          'blackjack:state',
          (s) => s.phase === 'PLAYING',
          0,
        ),
      ),
    );
    return { two, code };
  }

  it('rejects sockets without a valid token', async () => {
    await expect(connect('x', 'garbage')).rejects.toThrow('UNAUTHENTICATED');
  });

  it('requires a nickname before sitting at a table', async () => {
    const c = await connect('nonick');
    await expect(emit(c, 'blackjack:create')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NICKNAME_REQUIRED' },
    });
  });

  it('validates payloads', async () => {
    const c = await connect('u0');
    await expect(
      emit(c, 'blackjack:join', { code: 42 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
    await ok(c, 'blackjack:create');
    await expect(
      emit(c, 'blackjack:set_rules', { rules: { rounds: 7 } }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    await expect(
      emit(c, 'blackjack:bet', { actionId: 'action-bad-1', amount: 15 }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    await expect(
      emit(c, 'blackjack:act', { actionId: 'action-bad-2', action: 'fold' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
  });

  it('plays a round: same table for both, hole card hidden, replays run once', async () => {
    const { two } = await startedTable();
    const [a, b] = two;
    const bet = { actionId: 'action-bet-a1', amount: 100 };
    await ok(a, 'blackjack:bet', bet);
    await ok(a, 'blackjack:bet', bet);
    const since = b.events.length;
    await ok(b, 'blackjack:bet', { actionId: 'action-bet-b1', amount: 50 });
    const dealt = await waitFor<BjRoomState>(
      a,
      'blackjack:state',
      (s) => !!s.game && s.game.stage !== 'BETTING',
      0,
    );
    const seenByB = await waitFor<BjRoomState>(
      b,
      'blackjack:state',
      (s) => s.version === dealt.version,
      since,
    );
    expect(seenByB.game!.players).toEqual(dealt.game!.players);
    expect(dealt.game!.players[0]!.chips).toBe(900);
    if (dealt.game!.stage !== 'SETTLED')
      expect(dealt.game!.dealer.cards[1]).toBeNull();
    expect(a.events.filter((e) => e.event === 'blackjack:dealt')).toHaveLength(
      1,
    );

    if (dealt.game!.stage === 'PLAYING') {
      const turn = dealt.game!.turn!.seat;
      const [onTurn, waiting] = turn === 0 ? [a, b] : [b, a];
      await expect(
        emit(waiting, 'blackjack:act', {
          actionId: 'action-wrong-1',
          action: 'stand',
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
      await ok(onTurn, 'blackjack:act', {
        actionId: 'action-stand-1',
        action: 'stand',
      });
      await waitFor(waiting, 'blackjack:acted', () => true, 0);
    }
  });

  it('answers the insurance offer when the dealer shows an ace', async () => {
    const { two } = await startedTable();
    await ok(two[0], 'blackjack:bet', {
      actionId: 'action-bet-a2',
      amount: 10,
    });
    await ok(two[1], 'blackjack:bet', {
      actionId: 'action-bet-b2',
      amount: 10,
    });
    const state = await waitFor<BjRoomState>(
      two[0],
      'blackjack:state',
      (s) => !!s.game && s.game.stage !== 'BETTING',
      0,
    );
    const res = await emit(two[0], 'blackjack:insurance', {
      actionId: 'action-ins-1',
      take: false,
    });
    if (state.game!.stage === 'INSURANCE') expect(res.ok).toBe(true);
    else
      expect(res).toMatchObject({
        ok: false,
        error: { code: 'INVALID_STATE' },
      });
  });

  it('ends the match for both when one leaves', async () => {
    const { two } = await startedTable();
    await ok(two[1], 'blackjack:leave');
    const over = await waitFor<{ reason: string }>(
      two[0],
      'blackjack:match_over',
      () => true,
      0,
    );
    expect(over.reason).toBe('abandoned');
    await ok(two[0], 'blackjack:rematch');
  });

  it('lets the host change rules, stake and visibility in the lobby', async () => {
    const c = await connect('u0');
    await ok(c, 'blackjack:create');
    await ok(c, 'blackjack:set_rules', {
      rules: { rounds: 5, payout: '6:5', decks: 2, turnSeconds: 30 },
    });
    await ok(c, 'blackjack:set_stake', { stake: 60 });
    await ok(c, 'blackjack:set_visibility', { isPublic: false });
    const snap = await ok<BjSnapshot>(c, 'blackjack:sync');
    expect(snap.state).toMatchObject({
      stake: 60,
      isPublic: false,
      rules: { rounds: 5, payout: '6:5' },
    });
  });

  it('lists public tables live', async () => {
    const [watcher, a] = await Promise.all([connect('u4'), connect('u0')]);
    await expect(ok(watcher, 'blackjack:watch_rooms')).resolves.toEqual([]);
    const pub = await ok<BjSnapshot>(a, 'blackjack:create', { isPublic: true });
    const update = await waitFor<{ rooms: { code: string }[] }>(
      watcher,
      'blackjack:rooms_updated',
      (p) => p.rooms.length > 0,
    );
    expect(update.rooms[0].code).toBe(pub.state.code);
    await ok(watcher, 'blackjack:unwatch_rooms');
  });

  it('keeps the seat across a reconnection', async () => {
    const [a, b] = await Promise.all([connect('u0'), connect('u1')]);
    const { state } = await ok<BjSnapshot>(a, 'blackjack:create');
    await ok(b, 'blackjack:join', { code: state.code });
    b.socket.close();
    await waitFor(a, 'blackjack:player_disconnected', () => true, 0);
    const again = await connect('u1');
    const snap = await ok<BjSnapshot>(again, 'blackjack:join', {
      code: state.code,
    });
    expect(snap.mySeat).toBe(1);
    await waitFor(a, 'blackjack:player_reconnected', () => true, 0);
  });

  it('shows emotes to the whole table', async () => {
    const [a, b] = await Promise.all([connect('u0'), connect('u1')]);
    const { state } = await ok<BjSnapshot>(a, 'blackjack:create');
    await ok(b, 'blackjack:join', { code: state.code });
    await ok(a, 'blackjack:emote', { emote: 'clap' });
    await expect(waitFor(b, 'blackjack:emoted')).resolves.toEqual({
      seat: 0,
      emote: 'clap',
    });
  });
});

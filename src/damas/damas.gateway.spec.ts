import { ArenaService } from '../arena/arena.service';
import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import type { Ack, DamasRoomState, DamasSnapshot } from '../contracts';
import { JwtVerifier } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { cryptoRandomInt, RANDOM_INT } from '../core/random';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ProfilesService } from '../profiles/profiles.service';
import { SocketDamasPublisher, DAMAS_PUBLISHER } from './damas-publisher';
import { DAMAS_CONFIG, DamasRoomsService } from './damas-rooms.service';
import { DamasGateway } from './damas.gateway';

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

describe('DamasGateway (Socket.IO integration)', () => {
  let app: INestApplication;
  let url: string;
  let clients: Client[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DamasGateway,
        DamasRoomsService,
        {
          provide: ArenaService,
          useValue: {
            settleSafe: jest.fn().mockResolvedValue(null),
            assertStake: jest.fn().mockResolvedValue(undefined),
          },
        },
        SocketDamasPublisher,
        { provide: DAMAS_PUBLISHER, useExisting: SocketDamasPublisher },
        {
          provide: DAMAS_CONFIG,
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
    url = `http://127.0.0.1:${port}/damas`;
  });

  afterEach(async () => {
    // Leave explicitly: a plain disconnect would keep the seat reserved for the next test.
    await Promise.all(
      clients
        .filter((c) => c.socket.connected)
        .map((c) => emit(c, 'damas:leave').catch(() => undefined)),
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
    [...c.events].reverse().find((e) => e.event === 'damas:state')!
      .payload as DamasRoomState;

  async function startedTable() {
    const two = await Promise.all(['u0', 'u1'].map((u) => connect(u)));
    const created = await ok<DamasSnapshot>(two[0], 'damas:create');
    const code = created.state.code;
    await ok(two[1], 'damas:join', { code });
    for (const c of two) await ok(c, 'damas:ready', { ready: true });
    await ok(two[0], 'damas:start');
    await Promise.all(
      two.map((c) =>
        waitFor<DamasRoomState>(
          c,
          'damas:state',
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
    await expect(emit(c, 'damas:create')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NICKNAME_REQUIRED' },
    });
  });

  it('validates payloads', async () => {
    const c = await connect('u0');
    await expect(emit(c, 'damas:join', { code: 42 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
    await ok(c, 'damas:create');
    await expect(
      emit(c, 'damas:set_rules', { rules: { turnSeconds: 7 } }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    await expect(
      emit(c, 'damas:move', { actionId: 'action-bad-1', from: 99, path: [] }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
  });

  it('plays a full exchange: same board for both, moves out of turn refused, replays run once', async () => {
    const { two } = await startedTable();
    const [white, black] = two;
    const start = latestState(white).game!;
    expect(start.turn).toBe('white');
    const opening = start.moves[0];
    await expect(
      emit(black, 'damas:move', {
        actionId: 'action-black-1',
        from: opening.from,
        path: opening.path,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    const since = black.events.length;
    const move = {
      actionId: 'action-white-1',
      from: opening.from,
      path: opening.path,
    };
    await ok(white, 'damas:move', move);
    await ok(white, 'damas:move', move);
    const seen = await waitFor<DamasRoomState>(
      black,
      'damas:state',
      (s) => s.game?.turn === 'black',
      since,
    );
    expect(seen.game!.plies).toBe(1);
    expect(seen.game!.board).toBe(latestState(white).game!.board);
    expect(
      black.events.slice(since).filter((e) => e.event === 'damas:moved'),
    ).toHaveLength(1);
  });

  it('ends the match on resignation for both players', async () => {
    const { two } = await startedTable();
    await ok(two[1], 'damas:resign', { actionId: 'action-resign-1' });
    const over = await waitFor<{ winner: number; reason: string }>(
      two[0],
      'damas:match_over',
      () => true,
      0,
    );
    expect(over).toMatchObject({ winner: 0, reason: 'resign' });
  });

  it('negotiates a draw', async () => {
    const { two } = await startedTable();
    await ok(two[0], 'damas:offer_draw', { actionId: 'action-offer-1' });
    await waitFor(two[1], 'damas:draw_offered', () => true, 0);
    await ok(two[1], 'damas:answer_draw', {
      actionId: 'action-answer-1',
      accept: true,
    });
    await expect(
      waitFor(two[0], 'damas:match_over', () => true, 0),
    ).resolves.toMatchObject({
      winner: null,
      reason: 'draw_agreed',
    });
  });

  it('lists public tables live', async () => {
    const [watcher, a] = await Promise.all([connect('u4'), connect('u0')]);
    await expect(ok(watcher, 'damas:watch_rooms')).resolves.toEqual([]);
    const pub = await ok<DamasSnapshot>(a, 'damas:create', { isPublic: true });
    const update = await waitFor<{ rooms: { code: string }[] }>(
      watcher,
      'damas:rooms_updated',
      (p) => p.rooms.length > 0,
    );
    expect(update.rooms[0].code).toBe(pub.state.code);
  });

  it('keeps the seat across a reconnection', async () => {
    const [a, b] = await Promise.all([connect('u0'), connect('u1')]);
    const { state } = await ok<DamasSnapshot>(a, 'damas:create');
    await ok(b, 'damas:join', { code: state.code });
    b.socket.close();
    await waitFor(a, 'damas:player_disconnected', () => true, 0);
    const again = await connect('u1');
    const snap = await ok<DamasSnapshot>(again, 'damas:join', {
      code: state.code,
    });
    expect(snap.mySeat).toBe(1);
    await waitFor(a, 'damas:player_reconnected', () => true, 0);
  });

  it('shows emotes to the whole table', async () => {
    const [a, b] = await Promise.all([connect('u0'), connect('u1')]);
    const { state } = await ok<DamasSnapshot>(a, 'damas:create');
    await ok(b, 'damas:join', { code: state.code });
    await ok(a, 'damas:emote', { emote: 'clap' });
    await expect(waitFor(b, 'damas:emoted')).resolves.toEqual({
      seat: 0,
      emote: 'clap',
    });
  });
});

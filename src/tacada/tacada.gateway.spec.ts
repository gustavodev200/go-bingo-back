import { ArenaService } from '../arena/arena.service';
import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import type { Ack, TacadaRoomState, TacadaSnapshot } from '../contracts';
import { JwtVerifier } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { cryptoRandomInt, RANDOM_INT } from '../core/random';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ProfilesService } from '../profiles/profiles.service';
import { SocketTacadaPublisher, TACADA_PUBLISHER } from './tacada-publisher';
import { TACADA_CONFIG, TacadaRoomsService } from './tacada-rooms.service';
import { TacadaGateway } from './tacada.gateway';

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

describe('TacadaGateway (Socket.IO integration)', () => {
  let app: INestApplication;
  let url: string;
  let clients: Client[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TacadaGateway,
        TacadaRoomsService,
        {
          provide: ArenaService,
          useValue: {
            settleSafe: jest.fn().mockResolvedValue(null),
            assertStake: jest.fn().mockResolvedValue(undefined),
          },
        },
        SocketTacadaPublisher,
        { provide: TACADA_PUBLISHER, useExisting: SocketTacadaPublisher },
        {
          provide: TACADA_CONFIG,
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
    url = `http://127.0.0.1:${port}/tacada`;
  });

  afterEach(async () => {
    // Leave explicitly: a plain disconnect would keep the seat reserved for the next test.
    await Promise.all(
      clients
        .filter((c) => c.socket.connected)
        .map((c) => emit(c, 'tacada:leave').catch(() => undefined)),
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
    [...c.events].reverse().find((e) => e.event === 'tacada:state')!
      .payload as TacadaRoomState;

  async function startedTable() {
    const two = await Promise.all(['u0', 'u1'].map((u) => connect(u)));
    const created = await ok<TacadaSnapshot>(two[0], 'tacada:create');
    const code = created.state.code;
    await ok(two[1], 'tacada:join', { code });
    for (const c of two) await ok(c, 'tacada:ready', { ready: true });
    await ok(two[0], 'tacada:start');
    await Promise.all(
      two.map((c) =>
        waitFor<TacadaRoomState>(
          c,
          'tacada:state',
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
    await expect(emit(c, 'tacada:create')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NICKNAME_REQUIRED' },
    });
  });

  it('validates payloads', async () => {
    const c = await connect('u0');
    await expect(emit(c, 'tacada:join', { code: 42 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
    await ok(c, 'tacada:create');
    await expect(
      emit(c, 'tacada:set_rules', {
        rules: { shotSeconds: 7, aimGuide: 'long' },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    await expect(
      emit(c, 'tacada:shoot', {
        actionId: 'action-bad-1',
        dirX: 3,
        dirY: 0,
        power: 1,
        spinX: 0,
        spinY: 0,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
  });

  it('breaks: same table for both, shots out of turn refused, replays run once, aim relayed', async () => {
    const { two } = await startedTable();
    const [breaker, other] = two;
    const start = latestState(breaker).game!;
    expect(start).toMatchObject({ turn: 0, breakShot: true, ballInHand: true });
    const shot = {
      actionId: 'action-break-1',
      dirX: 1,
      dirY: 0,
      power: 1,
      spinX: 0,
      spinY: 0,
      cueX: 45,
      cueY: 50,
    };
    await expect(
      emit(other, 'tacada:shoot', { ...shot, actionId: 'action-other-1' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    const since = other.events.length;
    breaker.socket.emit('tacada:aim', { dirX: 1, dirY: 0, power: 0.5 });
    await expect(
      waitFor(other, 'tacada:aimed', () => true, since),
    ).resolves.toMatchObject({ seat: 0, dirX: 1, power: 0.5 });
    await ok(breaker, 'tacada:shoot', shot);
    await ok(breaker, 'tacada:shoot', shot);
    const seen = await waitFor<TacadaRoomState>(
      other,
      'tacada:state',
      (s) => (s.game?.shots ?? 0) === 1,
      since,
    );
    expect(seen.game!.balls).toEqual(latestState(breaker).game!.balls);
    expect(
      other.events.slice(since).filter((e) => e.event === 'tacada:shot'),
    ).toHaveLength(1);
    expect(
      breaker.events.filter((e) => e.event === 'tacada:aimed'),
    ).toHaveLength(0);
  });

  it('ends the match on resignation for both players', async () => {
    const { two } = await startedTable();
    await ok(two[1], 'tacada:resign', { actionId: 'action-resign-1' });
    const over = await waitFor<{ winner: number; reason: string }>(
      two[0],
      'tacada:match_over',
      () => true,
      0,
    );
    expect(over).toMatchObject({ winner: 0, reason: 'resign' });
  });

  it('lists public tables live', async () => {
    const [watcher, a] = await Promise.all([connect('u4'), connect('u0')]);
    await expect(ok(watcher, 'tacada:watch_rooms')).resolves.toEqual([]);
    const pub = await ok<TacadaSnapshot>(a, 'tacada:create', {
      isPublic: true,
    });
    const update = await waitFor<{ rooms: { code: string }[] }>(
      watcher,
      'tacada:rooms_updated',
      (p) => p.rooms.length > 0,
    );
    expect(update.rooms[0].code).toBe(pub.state.code);
  });

  it('keeps the seat across a reconnection', async () => {
    const [a, b] = await Promise.all([connect('u0'), connect('u1')]);
    const { state } = await ok<TacadaSnapshot>(a, 'tacada:create');
    await ok(b, 'tacada:join', { code: state.code });
    b.socket.close();
    await waitFor(a, 'tacada:player_disconnected', () => true, 0);
    const again = await connect('u1');
    const snap = await ok<TacadaSnapshot>(again, 'tacada:join', {
      code: state.code,
    });
    expect(snap.mySeat).toBe(1);
    await waitFor(a, 'tacada:player_reconnected', () => true, 0);
  });

  it('shows emotes to the whole table', async () => {
    const [a, b] = await Promise.all([connect('u0'), connect('u1')]);
    const { state } = await ok<TacadaSnapshot>(a, 'tacada:create');
    await ok(b, 'tacada:join', { code: state.code });
    await ok(a, 'tacada:emote', { emote: 'clap' });
    await expect(waitFor(b, 'tacada:emoted')).resolves.toEqual({
      seat: 0,
      emote: 'clap',
    });
  });
});

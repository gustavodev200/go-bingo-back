import { ArenaService } from '../arena/arena.service';
import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  DominoPrivateHand,
  DominoRoomState,
  DominoSnapshot,
} from '../contracts';
import { JwtVerifier } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { cryptoRandomInt, RANDOM_INT } from '../core/random';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ProfilesService } from '../profiles/profiles.service';
import { SocketDominoPublisher, DOMINO_PUBLISHER } from './domino-publisher';
import { DOMINO_CONFIG, DominoRoomsService } from './domino-rooms.service';
import { DominoGateway } from './domino.gateway';

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

describe('DominoGateway (Socket.IO integration)', () => {
  let app: INestApplication;
  let url: string;
  let clients: Client[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DominoGateway,
        DominoRoomsService,
        {
          provide: ArenaService,
          useValue: {
            settleSafe: jest.fn().mockResolvedValue(null),
            assertStake: jest.fn().mockResolvedValue(undefined),
          },
        },
        SocketDominoPublisher,
        { provide: DOMINO_PUBLISHER, useExisting: SocketDominoPublisher },
        {
          provide: DOMINO_CONFIG,
          useValue: {
            reconnectGraceMs: GRACE_MS,
            turnMs: 60_000,
            roundPauseMs: 50,
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
    url = `http://127.0.0.1:${port}/domino`;
  });

  afterEach(async () => {
    // Leave explicitly: a plain disconnect would keep the seat reserved for the next test.
    await Promise.all(
      clients
        .filter((c) => c.socket.connected)
        .map((c) => emit(c, 'domino:leave').catch(() => undefined)),
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
    [...c.events].reverse().find((e) => e.event === 'domino:state')!
      .payload as DominoRoomState;
  const latestHand = (c: Client) =>
    [...c.events].reverse().find((e) => e.event === 'domino:private_hand')
      ?.payload as DominoPrivateHand | undefined;

  async function startedTable() {
    const three = await Promise.all(['u0', 'u1', 'u2'].map((u) => connect(u)));
    const created = await ok<DominoSnapshot>(three[0], 'domino:create');
    const code = created.state.code;
    for (const c of three.slice(1)) await ok(c, 'domino:join', { code });
    for (const c of three) await ok(c, 'domino:ready', { ready: true });
    await ok(three[0], 'domino:start');
    await Promise.all(
      three.map((c) =>
        waitFor<DominoPrivateHand>(c, 'domino:private_hand', () => true, 0),
      ),
    );
    await Promise.all(
      three.map((c) =>
        waitFor<DominoRoomState>(
          c,
          'domino:state',
          (s) => s.phase === 'PLAYING',
          0,
        ),
      ),
    );
    return { three, code };
  }

  it('rejects sockets without a valid token', async () => {
    await expect(connect('x', 'garbage')).rejects.toThrow('UNAUTHENTICATED');
  });

  it('requires a nickname before sitting at a table', async () => {
    const c = await connect('nonick');
    await expect(emit(c, 'domino:create')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NICKNAME_REQUIRED' },
    });
  });

  it('validates payloads', async () => {
    const c = await connect('u0');
    await expect(emit(c, 'domino:join', { code: 42 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
    await ok(c, 'domino:create');
    await expect(
      emit(c, 'domino:set_rules', { rules: { target: 300 } }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    await expect(
      emit(c, 'domino:play', {
        actionId: 'action-bad-1',
        tileId: 'x',
        side: 'up',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
  });

  it('deals 7 private tiles to each player and nothing hidden in the public state', async () => {
    const { three } = await startedTable();
    for (const c of three) {
      const hand = latestHand(c)!;
      expect(hand.tiles).toHaveLength(7);
      const others = three.filter((o) => o !== c);
      for (const o of others)
        expect(JSON.stringify(o.events)).not.toContain(hand.tiles[0].id);
    }
    expect(latestState(three[0]).round!.handCounts.slice(0, 3)).toEqual([
      7, 7, 7,
    ]);
  });

  it('rejects moves out of turn and runs a repeated action id only once', async () => {
    const { three } = await startedTable();
    const turn = latestState(three[0]).round!.turn;
    const current = three[turn];
    const other = three[(turn + 1) % 3];
    await expect(
      emit(other, 'domino:draw', { actionId: 'action-other-1' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    const opening = latestHand(current)!.playable[0].id;
    const since = current.events.length;
    const move = { actionId: 'action-play-1', tileId: opening };
    await ok(current, 'domino:play', move);
    await ok(current, 'domino:play', move);
    await waitFor(current, 'domino:tile_played', () => true, since);
    const hand = await waitFor<DominoPrivateHand>(
      current,
      'domino:private_hand',
      (h) => h.tiles.length === 6,
      since,
    );
    expect(hand.tiles.map((t) => t.id)).not.toContain(opening);
    expect(
      current.events
        .slice(since)
        .filter((e) => e.event === 'domino:tile_played'),
    ).toHaveLength(1);
  });

  it('lists public tables live', async () => {
    const [watcher, a] = await Promise.all([connect('u4'), connect('u0')]);
    await expect(ok(watcher, 'domino:watch_rooms')).resolves.toEqual([]);
    const pub = await ok<DominoSnapshot>(a, 'domino:create', {
      isPublic: true,
    });
    const update = await waitFor<{ rooms: { code: string }[] }>(
      watcher,
      'domino:rooms_updated',
      (p) => p.rooms.length > 0,
    );
    expect(update.rooms[0].code).toBe(pub.state.code);
  });

  it('shows emotes to the whole table', async () => {
    const [a, b] = await Promise.all([connect('u0'), connect('u1')]);
    const { state } = await ok<DominoSnapshot>(a, 'domino:create');
    await ok(b, 'domino:join', { code: state.code });
    await ok(a, 'domino:emote', { emote: 'clap' });
    await expect(waitFor(b, 'domino:emoted')).resolves.toEqual({
      seat: 0,
      emote: 'clap',
    });
  });
});

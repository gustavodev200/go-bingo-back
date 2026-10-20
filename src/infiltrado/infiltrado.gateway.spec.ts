import { ArenaService } from '../arena/arena.service';
import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  InfFrame,
  InfPublicRoom,
  InfRoomState,
  InfSnapshot,
} from '../contracts';
import { JwtVerifier } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { cryptoRandomInt, RANDOM_INT } from '../core/random';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ProfilesService } from '../profiles/profiles.service';
import { INF_PUBLISHER, SocketInfPublisher } from './infiltrado-publisher';
import { INF_CONFIG, InfRoomsService } from './infiltrado-rooms.service';
import { InfGateway } from './infiltrado.gateway';

/**
 * Multiplayer integration: a real Nest app with the real gateway and real
 * Socket.IO clients. Auth and profiles are stubbed so it runs without a database.
 */
const NAMES: Record<string, string | null> = {
  u0: 'Ana',
  u1: 'Bia',
  u2: 'Caio',
  u3: 'Duda',
  nonick: null,
};

interface Client {
  userId: string;
  socket: Socket;
  events: { event: string; payload: unknown }[];
}

describe('InfGateway (Socket.IO integration)', () => {
  let app: INestApplication;
  let url: string;
  let clients: Client[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        InfGateway,
        InfRoomsService,
        {
          provide: ArenaService,
          useValue: { settleSafe: jest.fn().mockResolvedValue(null) },
        },
        SocketInfPublisher,
        { provide: INF_PUBLISHER, useExisting: SocketInfPublisher },
        {
          provide: INF_CONFIG,
          useValue: { reconnectGraceMs: 1_000, maxRooms: 50 },
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
    url = `http://127.0.0.1:${port}/infiltrado`;
  });

  afterEach(async () => {
    await Promise.all(
      clients
        .filter((c) => c.socket.connected)
        .map((c) => emit(c, 'inf:leave').catch(() => undefined)),
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

  function waitFor<T>(
    c: Client,
    event: string,
    match: (p: T) => boolean = () => true,
    since = 0,
    timeoutMs = 4000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const hit = c.events
          .slice(since)
          .find((e) => e.event === event && match(e.payload as T));
        if (hit) return resolve(hit.payload as T);
        if (Date.now() - started > timeoutMs)
          return reject(new Error(`timeout waiting ${event} on ${c.userId}`));
        setTimeout(tick, 10);
      };
      tick();
    });
  }

  it('rejects sockets without a valid token', async () => {
    await expect(connect('x', 'garbage')).rejects.toThrow('UNAUTHENTICATED');
  });

  it('requires a nickname and validates payloads', async () => {
    const nonick = await connect('nonick');
    await expect(emit(nonick, 'inf:create')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NICKNAME_REQUIRED' },
    });
    const c = await connect('u0');
    await expect(emit(c, 'inf:join', { code: 'x' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
    await expect(emit(c, 'inf:act', { t: 'teleport' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
    await expect(emit(c, 'inf:act', { t: 'emergency' })).resolves.toMatchObject(
      { ok: false, error: { code: 'NOT_IN_ROOM' } },
    );
  });

  it('lists public rooms live', async () => {
    const [watcher, host] = await Promise.all([connect('u2'), connect('u0')]);
    expect(await ok<InfPublicRoom[]>(watcher, 'inf:watch_rooms')).toEqual([]);
    const created = await ok<InfSnapshot>(host, 'inf:create', {
      isPublic: true,
    });
    const list = await waitFor<{ rooms: InfPublicRoom[] }>(
      watcher,
      'inf:rooms_updated',
      (p) => p.rooms.length === 1,
    );
    expect(list.rooms[0]).toMatchObject({ code: created.state.code });
  });

  it('plays: private frames per player, actions acked, roles hidden', async () => {
    const people = await Promise.all(
      ['u0', 'u1', 'u2', 'u3'].map((u) => connect(u)),
    );
    const [host, ...rest] = people;
    const { state } = await ok<InfSnapshot>(host, 'inf:create', {
      isPublic: false,
    });
    for (const c of rest) await ok(c, 'inf:join', { code: state.code });
    for (const c of people) await ok(c, 'inf:ready', { ready: true });
    await ok(host, 'inf:start');
    const frames = await Promise.all(
      people.map((c) => waitFor<InfFrame>(c, 'inf:frame')),
    );
    expect(frames.filter((f) => f.me.role === 'impostor')).toHaveLength(1);
    for (const c of people)
      for (const e of c.events.filter((x) => x.event === 'inf:state'))
        expect(JSON.stringify(e.payload)).not.toContain('"role"');

    // After the role reveal, joystick input moves my diver (no ack).
    const before = (
      await waitFor<InfFrame>(
        host,
        'inf:frame',
        (f) => f.phase === 'play',
        0,
        8000,
      )
    ).me;
    for (let s = 1; s <= 10; s++)
      host.socket.emit('inf:input', { s, x: 0, y: 1 });
    const moved = await waitFor<InfFrame>(
      host,
      'inf:frame',
      (f) => f.me.lastSeq === 10,
    );
    expect(moved.me.y).not.toBe(before.y);

    // Chat is closed outside meetings for the living.
    await expect(emit(host, 'inf:chat', { text: 'oi' })).resolves.toMatchObject(
      { ok: false },
    );
    // Someone leaves: the room carries on or ends, but always answers.
    const mark = host.events.length;
    await ok(rest[2], 'inf:leave');
    const after = await waitFor<InfRoomState>(
      host,
      'inf:state',
      (s) => !s.seats[3],
      mark,
    );
    expect(['PLAYING', 'FINISHED']).toContain(after.phase);
  }, 20_000);
});

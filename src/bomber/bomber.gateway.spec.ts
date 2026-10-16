import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  BomberFrame,
  BomberPublicRoom,
  BomberRoomState,
  BomberSnapshot,
} from '../contracts';
import { JwtVerifier } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { cryptoRandomInt, RANDOM_INT } from '../core/random';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ProfilesService } from '../profiles/profiles.service';
import { BOMBER_PUBLISHER, SocketBomberPublisher } from './bomber-publisher';
import { BOMBER_CONFIG, BomberRoomsService } from './bomber-rooms.service';
import { BomberGateway } from './bomber.gateway';

/**
 * Multiplayer integration: a real Nest app with the real gateway and real
 * Socket.IO clients. Auth and profiles are stubbed so it runs without a database.
 */
const NAMES: Record<string, string | null> = {
  u0: 'Ana',
  u1: 'Bia',
  u2: 'Caio',
  nonick: null,
};

interface Client {
  userId: string;
  socket: Socket;
  events: { event: string; payload: unknown }[];
}

describe('BomberGateway (Socket.IO integration)', () => {
  let app: INestApplication;
  let url: string;
  let clients: Client[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BomberGateway,
        BomberRoomsService,
        SocketBomberPublisher,
        { provide: BOMBER_PUBLISHER, useExisting: SocketBomberPublisher },
        {
          provide: BOMBER_CONFIG,
          useValue: { reconnectGraceMs: 1_000, roundPauseMs: 50, maxRooms: 50 },
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
    url = `http://127.0.0.1:${port}/bomber`;
  });

  afterEach(async () => {
    await Promise.all(
      clients
        .filter((c) => c.socket.connected)
        .map((c) => emit(c, 'bomber:leave').catch(() => undefined)),
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
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const hit = c.events
          .slice(since)
          .find((e) => e.event === event && match(e.payload as T));
        if (hit) return resolve(hit.payload as T);
        if (Date.now() - started > 4000)
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
    await expect(emit(nonick, 'bomber:create')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NICKNAME_REQUIRED' },
    });
    const c = await connect('u0');
    await expect(emit(c, 'bomber:join', { code: 'x' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
    await expect(emit(c, 'bomber:start')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_IN_ROOM' },
    });
  });

  it('lists public rooms live and hides private ones', async () => {
    const [watcher, host, other] = await Promise.all([
      connect('u2'),
      connect('u0'),
      connect('u1'),
    ]);
    expect(await ok<BomberPublicRoom[]>(watcher, 'bomber:watch_rooms')).toEqual(
      [],
    );
    const created = await ok<BomberSnapshot>(host, 'bomber:create', {
      isPublic: true,
    });
    const list = await waitFor<{ rooms: BomberPublicRoom[] }>(
      watcher,
      'bomber:rooms_updated',
      (p) => p.rooms.length === 1,
    );
    expect(list.rooms[0]).toMatchObject({
      code: created.state.code,
      players: 1,
    });
    await ok(other, 'bomber:create', { isPublic: false });
    await ok(host, 'bomber:set_visibility', { isPublic: false });
    await waitFor<{ rooms: BomberPublicRoom[] }>(
      watcher,
      'bomber:rooms_updated',
      (p) => p.rooms.length === 0,
    );
    await ok(watcher, 'bomber:unwatch_rooms');
  });

  it('runs a match with a CPU: lobby, frames, inputs', async () => {
    const [a, b] = await Promise.all([connect('u0'), connect('u1')]);
    const created = await ok<BomberSnapshot>(a, 'bomber:create');
    const code = created.state.code;
    const joined = await ok<BomberSnapshot>(b, 'bomber:join', { code });
    expect(joined.mySeat).toBe(1);
    await ok(a, 'bomber:add_bot');
    await ok(a, 'bomber:remove_bot', { seat: 2 });
    await ok(a, 'bomber:add_bot');
    await ok(b, 'bomber:set_color', { color: 6 });
    await ok(a, 'bomber:set_rules', { rules: { winsToWin: 1 } });
    await ok(a, 'bomber:ready', { ready: true });
    await ok(b, 'bomber:ready', { ready: true });
    const synced = await ok<BomberSnapshot>(b, 'bomber:sync');
    expect(synced.state.seats[1]!.color).toBe(6);
    expect(synced.state.lobbyStatus).toBe('READY_TO_START');
    await expect(emit(b, 'bomber:start')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_HOST' },
    });
    await ok(a, 'bomber:start');
    const frame = await waitFor<BomberFrame>(
      b,
      'bomber:frame',
      (f) => f.phase === 'play',
    );
    expect(frame.players).toHaveLength(3);
    for (let s = 1; s <= 5; s++)
      b.socket.emit('bomber:input', { s, d: 4, b: false, a: false });
    b.socket.emit('bomber:input', { garbage: true });
    await waitFor<BomberFrame>(b, 'bomber:frame', (f) =>
      f.players.some((p) => p[0] === 1 && p[8] === 5),
    );
    const state = await waitFor<BomberRoomState>(
      b,
      'bomber:state',
      (s) => s.phase === 'PLAYING',
    );
    expect(state.roundNumber).toBe(1);
  });

  it('a disconnect keeps the seat and a new socket gets it back', async () => {
    const a = await connect('u0');
    const b = await connect('u1');
    const { state } = await ok<BomberSnapshot>(a, 'bomber:create');
    await ok(b, 'bomber:join', { code: state.code });
    b.socket.close();
    await waitFor<BomberRoomState>(
      a,
      'bomber:state',
      (s) => s.seats[1]?.connected === false,
    );
    const b2 = await connect('u1');
    const back = await ok<BomberSnapshot>(b2, 'bomber:join', {
      code: state.code,
    });
    expect(back.mySeat).toBe(1);
    await ok(b2, 'bomber:leave');
  });

  it('rate limits bursts and ignores input floods', async () => {
    const c = await connect('u2');
    for (let i = 0; i < 100; i++)
      c.socket.emit('bomber:input', { s: i, d: 0, b: false, a: false });
    const results = await Promise.all(
      Array.from({ length: 12 }, () => emit(c, 'bomber:sync')),
    );
    expect(results.some((r) => !r.ok && r.error.code === 'RATE_LIMITED')).toBe(
      true,
    );
  });

  it('host rematch brings everybody back to the lobby', async () => {
    const a = await connect('u0');
    await ok<BomberSnapshot>(a, 'bomber:create');
    await expect(emit(a, 'bomber:rematch')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
  });
});

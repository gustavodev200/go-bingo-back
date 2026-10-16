import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import {
  decodeSnakeFrame,
  type Ack,
  type SnakeFrame,
  type SnakeJoinData,
  type SnakeServerEventPayloads,
} from '../contracts';
import { JwtVerifier } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ProfilesService } from '../profiles/profiles.service';
import { SNAKE_CONFIG, SnakeArenasService } from './snake-arenas.service';
import { SNAKE_PUBLISHER, SocketSnakePublisher } from './snake-publisher';
import { SnakeGateway } from './snake.gateway';

/**
 * Multiplayer integration: a real Nest app with the real gateway and real
 * Socket.IO clients. Auth and profiles are stubbed so it runs without a database.
 */
const NAMES: Record<string, string | null> = {
  u0: 'Ana',
  u1: 'Bia',
  nonick: null,
};

interface Client {
  userId: string;
  socket: Socket;
  events: { event: string; payload: unknown }[];
  frames: SnakeFrame[];
}

describe('SnakeGateway (Socket.IO integration)', () => {
  let app: INestApplication;
  let url: string;
  let clients: Client[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SnakeGateway,
        SnakeArenasService,
        SocketSnakePublisher,
        { provide: SNAKE_PUBLISHER, useExisting: SocketSnakePublisher },
        {
          provide: SNAKE_CONFIG,
          useValue: { bots: 0, maxPlayers: 40, maxArenas: 5 },
        },
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
    url = `http://127.0.0.1:${port}/snake`;
  });

  afterEach(() => {
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
    const client: Client = { userId, socket, events: [], frames: [] };
    socket.onAny((event: string, payload: unknown) => {
      if (event === 'snake:frame')
        client.frames.push(decodeSnakeFrame(payload as ArrayBuffer));
      else client.events.push({ event, payload });
    });
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

  function until<T>(fn: () => T | undefined, what: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const hit = fn();
        if (hit !== undefined) return resolve(hit);
        if (Date.now() - started > 4000)
          return reject(new Error(`timeout waiting ${what}`));
        setTimeout(tick, 10);
      };
      tick();
    });
  }

  it('rejects sockets without a valid token', async () => {
    await expect(connect('x', 'garbage')).rejects.toThrow('UNAUTHENTICATED');
  });

  it('requires a nickname, a joined arena and valid payloads', async () => {
    const nonick = await connect('nonick');
    await expect(emit(nonick, 'snake:join')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NICKNAME_REQUIRED' },
    });
    const c = await connect('u0');
    await expect(emit(c, 'snake:play', { skin: 0 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_IN_ROOM' },
    });
    await expect(emit(c, 'snake:play', { skin: 99 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
    await expect(emit(c, 'snake:join', { x: 1 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
  });

  it('two players share an arena: frames, meta, leaderboard and binary view', async () => {
    const [ana, bia] = await Promise.all([connect('u0'), connect('u1')]);
    const ja = await ok<SnakeJoinData>(ana, 'snake:join');
    const jb = await ok<SnakeJoinData>(bia, 'snake:join');
    expect(jb.arena).toBe(ja.arena);
    ana.socket.emit('snake:view', { w: 1200, h: 800 });
    const { id } = await ok<{ id: number }>(ana, 'snake:play', { skin: 2 });
    await until(
      () =>
        bia.events.find(
          (e) =>
            e.event === 'snake:meta' &&
            (e.payload as { meta: unknown[][] }).meta[0][0] === id,
        ),
      'meta on the other client',
    );
    const mine = await until(
      () => ana.frames.find((f) => f.myId === id),
      'own frame',
    );
    expect(mine.snakes.get(id)?.pts.get(0)).toBeDefined();
    ana.socket.emit('snake:input', { a: 1.2, b: true });
    ana.socket.emit('snake:input', { a: 'bad' });
    const lb = await until(
      () =>
        ana.events.find((e) => e.event === 'snake:leaderboard')?.payload as
          SnakeServerEventPayloads['snake:leaderboard'] | undefined,
      'leaderboard',
    );
    expect(lb.top.some((t) => t.name === 'Ana')).toBe(true);
    expect(lb.rank).toBeGreaterThan(0);
  });

  it('leaving kills the snake and the others see it in the feed', async () => {
    const [ana, bia] = await Promise.all([connect('u0'), connect('u1')]);
    await ok(ana, 'snake:join');
    await ok(bia, 'snake:join');
    await ok(ana, 'snake:play', { skin: 0 });
    await expect(ok(ana, 'snake:leave')).resolves.toBeNull();
    const feed = await until(
      () =>
        bia.events.find((e) => e.event === 'snake:feed')?.payload as
          SnakeServerEventPayloads['snake:feed'] | undefined,
      'feed',
    );
    expect(feed).toMatchObject({ victim: 'Ana', killer: null });
  });
});

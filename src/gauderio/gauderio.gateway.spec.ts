import { ArenaService } from '../arena/arena.service';
import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  GaudPrivateHand,
  GaudRoomState,
  GaudSnapshot,
} from '../contracts';
import { JwtVerifier } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { cryptoRandomInt, RANDOM_INT } from '../core/random';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ProfilesService } from '../profiles/profiles.service';
import { SocketGaudPublisher, GAUD_PUBLISHER } from './gauderio-publisher';
import { GAUD_CONFIG, GaudRoomsService } from './gauderio-rooms.service';
import { GaudGateway } from './gauderio.gateway';

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

describe('GaudGateway (Socket.IO integration)', () => {
  let app: INestApplication;
  let url: string;
  let clients: Client[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        GaudGateway,
        GaudRoomsService,
        {
          provide: ArenaService,
          useValue: {
            settleSafe: jest.fn().mockResolvedValue(null),
            assertStake: jest.fn().mockResolvedValue(undefined),
          },
        },
        SocketGaudPublisher,
        { provide: GAUD_PUBLISHER, useExisting: SocketGaudPublisher },
        {
          provide: GAUD_CONFIG,
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
    url = `http://127.0.0.1:${port}/gauderio`;
  });

  afterEach(async () => {
    // Leave explicitly: a plain disconnect would keep the seat reserved for the next test.
    await Promise.all(
      clients
        .filter((c) => c.socket.connected)
        .map((c) => emit(c, 'gauderio:leave').catch(() => undefined)),
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
    [...c.events].reverse().find((e) => e.event === 'gauderio:state')!
      .payload as GaudRoomState;
  const latestHand = (c: Client) =>
    [...c.events].reverse().find((e) => e.event === 'gauderio:private_hand')
      ?.payload as GaudPrivateHand | undefined;

  async function duel() {
    const two = await Promise.all(['u0', 'u1'].map((u) => connect(u)));
    const created = await ok<GaudSnapshot>(two[0], 'gauderio:create', {
      isPublic: true,
      settings: { size: 2, target: 12, flor: false },
    });
    const code = created.state.code;
    await ok(two[1], 'gauderio:join', { code });
    for (const c of two) await ok(c, 'gauderio:ready', { ready: true });
    await ok(two[0], 'gauderio:start');
    await Promise.all(
      two.map((c) =>
        waitFor<GaudPrivateHand>(c, 'gauderio:private_hand', () => true, 0),
      ),
    );
    await Promise.all(
      two.map((c) =>
        waitFor<GaudRoomState>(
          c,
          'gauderio:state',
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
    await expect(emit(c, 'gauderio:create')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NICKNAME_REQUIRED' },
    });
  });

  it('validates payloads and lists public tables live', async () => {
    const [watcher, a, b] = await Promise.all([
      connect('u4'),
      connect('u0'),
      connect('u1'),
    ]);
    await expect(ok(watcher, 'gauderio:watch_rooms')).resolves.toEqual([]);
    await expect(
      emit(a, 'gauderio:create', {
        settings: { size: 3, target: 12, flor: true },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    const pub = await ok<GaudSnapshot>(a, 'gauderio:create', {
      isPublic: true,
    });
    await ok(b, 'gauderio:create', { isPublic: false });
    const update = await waitFor<{ rooms: { code: string }[] }>(
      watcher,
      'gauderio:rooms_updated',
      (p) => p.rooms.length > 0,
    );
    expect(update.rooms.map((r) => r.code)).toEqual([pub.state.code]);
    await ok(a, 'gauderio:set_settings', {
      settings: { size: 4, target: 24, flor: true },
    });
    await ok(a, 'gauderio:set_visibility', { isPublic: false });
    await ok(a, 'gauderio:set_stake', { stake: pub.state.stake });
    await ok(watcher, 'gauderio:unwatch_rooms');
    await expect(
      emit(watcher, 'gauderio:join', { code: 'ZZZZZZ' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    await ok(b, 'gauderio:take_seat', { seat: 1 }).catch(() => undefined);
  });

  it('plays a hand over the wire: private hands, truco, fold and dedupe', async () => {
    const { two } = await duel();
    const state = latestState(two[0]);
    const turn = state.match!.turn;
    const actor = two[turn];
    const other = two[1 - turn];
    expect(latestHand(actor)!.cards).toHaveLength(3);
    // Nunca vaza a carta do outro.
    const otherIds = latestHand(other)!.cards.map((c) => c.id);
    expect(JSON.stringify(actor.events)).not.toContain(otherIds[0]);

    await ok(actor, 'gauderio:call', { actionId: 'call-0001', call: 'truco' });
    // Repetir a mesma ação devolve a mesma resposta, sem cantar de novo.
    await ok(actor, 'gauderio:call', { actionId: 'call-0001', call: 'truco' });
    await waitFor(other, 'gauderio:called', () => true, 0);
    await ok(other, 'gauderio:respond', {
      actionId: 'resp-0001',
      accept: true,
    });
    await waitFor<GaudRoomState>(
      actor,
      'gauderio:state',
      (s) => s.match?.trucoValue === 2,
      0,
    );
    const card = latestHand(actor)!.cards[0].id;
    await ok(actor, 'gauderio:play_card', {
      actionId: 'play-0001',
      cardId: card,
    });
    await expect(
      emit(actor, 'gauderio:play_card', {
        actionId: 'play-0002',
        cardId: card,
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      emit(other, 'gauderio:chat', { to: 'team', key: 'taunt' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    await ok(other, 'gauderio:chat', { to: 'table', key: 'nice' });
    const said = await waitFor<{ text: string }>(
      actor,
      'gauderio:chat_message',
      () => true,
      0,
    );
    expect(said.text).toBe('Boa jogada!');
    await ok(other, 'gauderio:fold', { actionId: 'fold-0001' });
    const ended = await waitFor<{ points: number; reason: string }>(
      actor,
      'gauderio:hand_ended',
      () => true,
      0,
    );
    expect(ended).toMatchObject({ points: 2, reason: 'folded' });
    const snap = await ok<GaudSnapshot>(actor, 'gauderio:sync');
    expect(snap.state.scores[1 - turn]).toBe(0);
  });

  it('leaving mid-match is a walkover and rematch goes back to the lobby', async () => {
    const { two } = await duel();
    await ok(two[1], 'gauderio:leave');
    const s = await waitFor<GaudRoomState>(
      two[0],
      'gauderio:state',
      (x) => x.phase === 'FINISHED',
      0,
    );
    expect(s.result).toMatchObject({ winnerTeam: 0, reason: 'abandoned' });
    await ok(two[0], 'gauderio:rematch');
    await expect(emit(two[0], 'gauderio:start')).resolves.toMatchObject({
      ok: false,
    });
  });
});

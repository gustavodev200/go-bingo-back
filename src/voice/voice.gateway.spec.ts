import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import type { Ack, VoiceJoined } from '../contracts';
import { JwtVerifier } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { ProfilesService } from '../profiles/profiles.service';
import { VoiceChannelsService } from './voice-channels.service';
import { VOICE_CONFIG, VOICE_MEMBERSHIP, VoiceGateway } from './voice.gateway';

/**
 * Signaling integration: a real Nest app with the real gateway and real
 * Socket.IO clients. Auth, profiles and game membership are stubbed.
 */
const NAMES: Record<string, string | null> = {
  u0: 'Ana',
  u1: 'Bia',
  u2: 'Caio',
  nonick: null,
};
const CODE = 'ABCDEF';
const ICE = [{ urls: 'stun:example.org:3478' }];

interface Client {
  userId: string;
  socket: Socket;
  events: { event: string; payload: unknown }[];
}

describe('VoiceGateway (Socket.IO integration)', () => {
  let app: INestApplication;
  let url: string;
  let gateway: VoiceGateway;
  let clients: Client[] = [];
  /** `${game}:${code}:${userId}` of whoever is seated in a game room. */
  const seated = new Set<string>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceGateway,
        VoiceChannelsService,
        {
          provide: VOICE_CONFIG,
          useValue: { iceServers: ICE, sweepMs: 60_000 },
        },
        {
          provide: VOICE_MEMBERSHIP,
          useValue: {
            isMember: (game: string, code: string, userId: string) =>
              Promise.resolve(seated.has(`${game}:${code}:${userId}`)),
          },
        },
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
    gateway = app.get(VoiceGateway);
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${port}/voice`;
  });

  beforeEach(() => {
    seated.clear();
    for (const u of ['u0', 'u1', 'u2', 'nonick'])
      seated.add(`uno:${CODE}:${u}`);
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
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const hit = c.events.find(
          (e) => e.event === event && match(e.payload as T),
        );
        if (hit) return resolve(hit.payload as T);
        if (Date.now() - started > 3000)
          return reject(new Error(`timeout waiting ${event} on ${c.userId}`));
        setTimeout(tick, 10);
      };
      tick();
    });
  }

  const join = (c: Client, muted = false) =>
    ok<VoiceJoined>(c, 'voice:join', { game: 'uno', code: CODE, muted });

  it('rejects sockets without a valid token', async () => {
    await expect(connect('x', 'garbage')).rejects.toThrow('UNAUTHENTICATED');
  });

  it('validates payloads', async () => {
    const c = await connect('u0');
    await expect(
      emit(c, 'voice:join', { game: 'poker', code: CODE, muted: false }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
  });

  it('requires a nickname', async () => {
    const c = await connect('nonick');
    await expect(
      emit(c, 'voice:join', { game: 'uno', code: CODE, muted: false }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'NICKNAME_REQUIRED' },
    });
  });

  it('only lets players of the game room in', async () => {
    const c = await connect('u0');
    await expect(
      emit(c, 'voice:join', { game: 'truco', code: CODE, muted: false }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_IN_ROOM' } });
  });

  it('introduces peers to each other and relays the handshake', async () => {
    const [a, b] = await Promise.all([connect('u0'), connect('u1')]);
    const first = await join(a);
    expect(first).toEqual({ peerId: a.socket.id, peers: [], iceServers: ICE });

    const second = await join(b, true);
    expect(second.peers).toEqual([
      { peerId: a.socket.id, userId: 'u0', nickname: 'Ana', muted: false },
    ]);
    await waitFor(
      a,
      'voice:peer_joined',
      (p: { peerId: string; muted: boolean }) =>
        p.peerId === b.socket.id && p.muted,
    );

    const offer = { kind: 'offer', sdp: 'v=0' };
    await ok(b, 'voice:signal', { to: a.socket.id, data: offer });
    await expect(waitFor(a, 'voice:signal')).resolves.toEqual({
      from: b.socket.id,
      data: offer,
    });

    await ok(a, 'voice:mute', { muted: true });
    await waitFor(b, 'voice:peer_updated', (p: { muted: boolean }) => p.muted);
  });

  it('refuses to relay to sockets outside the channel', async () => {
    const [a, b] = await Promise.all([connect('u0'), connect('u1')]);
    await join(a);
    await expect(
      emit(a, 'voice:signal', {
        to: b.socket.id,
        data: { kind: 'answer', sdp: 'v=0' },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_IN_ROOM' } });
    expect(b.events.some((e) => e.event === 'voice:signal')).toBe(false);
  });

  it('announces leaves and disconnects', async () => {
    const [a, b, c] = await Promise.all([
      connect('u0'),
      connect('u1'),
      connect('u2'),
    ]);
    await join(a);
    await join(b);
    await join(c);
    const bId = b.socket.id;
    await ok(b, 'voice:leave');
    await waitFor(
      a,
      'voice:peer_left',
      (p: { peerId: string }) => p.peerId === bId,
    );
    const cId = c.socket.id;
    c.socket.close();
    await waitFor(
      a,
      'voice:peer_left',
      (p: { peerId: string }) => p.peerId === cId,
    );
  });

  it('closes the older tab when the same user joins again', async () => {
    const [a, old] = await Promise.all([connect('u0'), connect('u1')]);
    await join(a);
    await join(old);
    const fresh = await connect('u1');
    const res = await join(fresh);
    expect(res.peers.map((p) => p.peerId)).toEqual([a.socket.id]);
    await waitFor(
      old,
      'voice:removed',
      (p: { reason: string }) => p.reason === 'replaced',
    );
    await waitFor(
      a,
      'voice:peer_left',
      (p: { peerId: string }) => p.peerId === old.socket.id,
    );
  });

  it('drops players who left the game room', async () => {
    const [a, b] = await Promise.all([connect('u0'), connect('u1')]);
    await join(a);
    await join(b);
    seated.delete(`uno:${CODE}:u1`);
    await gateway.sweep();
    await waitFor(
      b,
      'voice:removed',
      (p: { reason: string }) => p.reason === 'not_member',
    );
    await waitFor(
      a,
      'voice:peer_left',
      (p: { peerId: string }) => p.peerId === b.socket.id,
    );
    await expect(
      emit(b, 'voice:signal', {
        to: a.socket.id,
        data: { kind: 'answer', sdp: 'v=0' },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_IN_ROOM' } });
  });
});

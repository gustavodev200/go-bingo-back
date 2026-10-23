import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import { JwtVerifier } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { PRESENCE_BROADCAST_MS, PresenceGateway } from './presence.gateway';

/** Real Nest app + real Socket.IO clients; only the JWT check is stubbed. */
describe('PresenceGateway (Socket.IO integration)', () => {
  let app: INestApplication;
  let url: string;
  let gateway: PresenceGateway;
  let sockets: Socket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PresenceGateway,
        {
          provide: JwtVerifier,
          useValue: {
            verify: (token: string) =>
              token.startsWith('ok:')
                ? Promise.resolve({ id: token.slice(3), isAnonymous: false })
                : Promise.reject(new DomainError('UNAUTHENTICATED', 'no')),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0, '127.0.0.1');
    gateway = app.get(PresenceGateway);
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${port}/presence`;
  });

  afterEach(async () => {
    sockets.forEach((s) => s.close());
    sockets = [];
    await waitFor(() => gateway.online === 0);
  });

  afterAll(() => app.close());

  /** Resolves with the socket and the first count it received. */
  function connect(
    userId: string,
    token = `ok:${userId}`,
  ): Promise<{ socket: Socket; first: number; counts: number[] }> {
    const socket = io(url, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    const counts: number[] = [];
    return new Promise((resolve, reject) => {
      socket.on('presence:count', (p: { online: number }) => {
        counts.push(p.online);
        if (counts.length === 1) {
          sockets.push(socket);
          resolve({ socket, first: p.online, counts });
        }
      });
      socket.once('connect_error', (error) => {
        socket.close();
        reject(error);
      });
    });
  }

  async function waitFor(check: () => boolean, ms = 3000) {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it('rejects sockets without a valid token', async () => {
    await expect(connect('x', 'bad')).rejects.toThrow('UNAUTHENTICATED');
    const noAuth = io(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    await expect(
      new Promise((_, reject) => noAuth.once('connect_error', reject)),
    ).rejects.toThrow('UNAUTHENTICATED');
    noAuth.close();
    expect(gateway.online).toBe(0);
  });

  it('counts distinct users and tells the newcomer right away', async () => {
    const a = await connect('u1');
    expect(a.first).toBe(1);
    const b = await connect('u2');
    expect(b.first).toBe(2);
  });

  it('counts several tabs of the same user once', async () => {
    await connect('u1');
    const tab2 = await connect('u1');
    expect(tab2.first).toBe(1);
    tab2.socket.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(gateway.online).toBe(1);
  });

  it('pushes the new total to everyone when someone joins or leaves', async () => {
    const a = await connect('u1');
    const b = await connect('u2');
    await waitFor(() => a.counts.at(-1) === 2);
    b.socket.close();
    await waitFor(() => a.counts.at(-1) === 1, PRESENCE_BROADCAST_MS * 4);
    expect(gateway.online).toBe(1);
  });
});

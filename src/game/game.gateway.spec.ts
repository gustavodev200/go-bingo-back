import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ClientEvents, roomChannel, ServerEvents } from '../contracts';
import { DomainError } from '../core/domain-error';
import type { JwtVerifier } from '../core/auth/jwt-verifier';
import type { ProfilesService } from '../profiles/profiles.service';
import type { RoomsService } from '../rooms/rooms.service';
import { GameGateway } from './game.gateway';
import type { GameRunner } from './game-runner.service';
import type { GamesService } from './games.service';
import type { MembershipService } from './membership.service';
import type { PresenceService } from './presence.service';
import type { RealtimePublisher } from './realtime-publisher';
import type { SnapshotService } from './snapshot.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

function makeDeps() {
  const verifier = { verify: jest.fn() };
  const profiles = { ensure: jest.fn().mockResolvedValue(undefined) };
  const rooms = { listPublic: jest.fn() };
  const membership = {
    join: jest.fn(),
    leave: jest.fn(),
    kick: jest.fn(),
    cancel: jest.fn(),
    generateCard: jest.fn(),
    assertHost: jest.fn(),
  };
  const games = { mark: jest.fn(), claim: jest.fn() };
  const snapshots = { build: jest.fn() };
  const presence = {
    setExpiryHandler: jest.fn<void, [(code: string, userId: string) => void]>(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    remove: jest.fn(),
    clearRoom: jest.fn(),
    armOffline: jest.fn(),
  };
  const publisher = {
    attach: jest.fn(),
    toRoom: jest.fn(),
    toUser: jest.fn(),
    publicRoomsChanged: jest.fn(),
    removeUserFromRoom: jest.fn(),
    closeRoomChannel: jest.fn(),
  };
  const runner = {
    start: jest.fn(),
    stop: jest.fn(),
    broadcastSnapshots: jest.fn(),
  };
  const gateway = new GameGateway(
    verifier as unknown as JwtVerifier,
    profiles as unknown as ProfilesService,
    rooms as unknown as RoomsService,
    membership as unknown as MembershipService,
    games as unknown as GamesService,
    snapshots as unknown as SnapshotService,
    presence as unknown as PresenceService,
    publisher as unknown as RealtimePublisher,
    runner as unknown as GameRunner,
  );
  return {
    gateway,
    verifier,
    profiles,
    rooms,
    membership,
    games,
    snapshots,
    presence,
    publisher,
    runner,
  };
}

interface FakeSocketData {
  user?: { id: string; isAnonymous: boolean };
  roomCode?: string;
  joiningCode?: string;
}

interface FakeSocket {
  id: string;
  connected: boolean;
  data: FakeSocketData;
  rooms: Set<string>;
  join: jest.Mock<Promise<void>, [string]>;
  leave: jest.Mock<Promise<void>, [string]>;
  to: jest.Mock<{ emit: jest.Mock }, [string]>;
}

/** Any gateway handler's first parameter is socket.io's `Socket`, which our
 * plain test double only mimics structurally — `never` opts out of that
 * structural check at the call boundary while keeping `FakeSocket`'s real
 * shape for every assertion below. */
function asGatewaySocket(socket: FakeSocket): never {
  return socket as never;
}

function makeSocket(user: { id: string; isAnonymous: boolean } | undefined): {
  socket: FakeSocket;
  roomsJoined: Set<string>;
  emit: jest.Mock;
} {
  const roomsJoined = new Set<string>();
  const emit = jest.fn();
  const socket: FakeSocket = {
    id: 'socket-1',
    connected: true,
    data: { user, roomCode: undefined, joiningCode: undefined },
    rooms: roomsJoined,
    join: jest.fn((room: string) => {
      roomsJoined.add(room);
      return Promise.resolve();
    }),
    leave: jest.fn((room: string) => {
      roomsJoined.delete(room);
      return Promise.resolve();
    }),
    to: jest.fn<{ emit: jest.Mock }, [string]>(() => ({ emit })),
  };
  return { socket, roomsJoined, emit };
}

const user = { id: randomUUID(), isAnonymous: false };

describe('GameGateway.afterInit', () => {
  it('attaches the publisher and wires the auth middleware', () => {
    const { gateway, publisher } = makeDeps();
    let middleware!: (socket: unknown, next: (err?: Error) => void) => void;
    const server = {
      use: jest.fn((fn: typeof middleware) => (middleware = fn)),
    };

    gateway.afterInit(server as never);

    expect(publisher.attach).toHaveBeenCalledWith(server);
    expect(server.use).toHaveBeenCalledTimes(1);
    expect(typeof middleware).toBe('function');
  });

  it('rejects a connection with no bearer token', () => {
    const { gateway } = makeDeps();
    let middleware!: (socket: unknown, next: (err?: Error) => void) => void;
    gateway.afterInit({
      use: (fn: typeof middleware) => (middleware = fn),
    } as never);

    const next = jest.fn();
    middleware({ handshake: { auth: {} }, data: {} }, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('authenticates, ensures the profile and joins the user channel', async () => {
    const { gateway, verifier, profiles } = makeDeps();
    verifier.verify.mockResolvedValue(user);
    let middleware!: (socket: unknown, next: (err?: Error) => void) => void;
    gateway.afterInit({
      use: (fn: typeof middleware) => (middleware = fn),
    } as never);

    const next = jest.fn();
    const join = jest.fn().mockResolvedValue(undefined);
    const socket = { handshake: { auth: { token: 'abc' } }, data: {}, join };
    middleware(socket, next);
    await new Promise((resolve) => process.nextTick(resolve));
    await new Promise((resolve) => process.nextTick(resolve));

    expect(verifier.verify).toHaveBeenCalledWith('abc');
    expect(profiles.ensure).toHaveBeenCalledWith(user);
    expect((socket.data as { user?: unknown }).user).toEqual(user);
    expect(join).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects when the verifier throws', async () => {
    const { gateway, verifier } = makeDeps();
    verifier.verify.mockRejectedValue(new DomainError('UNAUTHENTICATED', 'x'));
    let middleware!: (socket: unknown, next: (err?: Error) => void) => void;
    gateway.afterInit({
      use: (fn: typeof middleware) => (middleware = fn),
    } as never);

    const next = jest.fn();
    middleware(
      { handshake: { auth: { token: 'bad' } }, data: {}, join: jest.fn() },
      next,
    );
    await new Promise((resolve) => process.nextTick(resolve));
    await new Promise((resolve) => process.nextTick(resolve));

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('routes an expired presence entry through removeMember', async () => {
    const { gateway, presence, membership, publisher } = makeDeps();
    membership.leave.mockResolvedValue({ removed: true, closed: false });
    gateway.afterInit({ use: jest.fn() } as never);

    const onExpired = presence.setExpiryHandler.mock.calls[0][0];
    onExpired('ABC123', user.id);
    await new Promise((resolve) => process.nextTick(resolve));
    await new Promise((resolve) => process.nextTick(resolve));

    expect(membership.leave).toHaveBeenCalledWith('ABC123', user.id);
    expect(publisher.toRoom).toHaveBeenCalledWith(
      'ABC123',
      ServerEvents.MEMBER_LEFT,
      { userId: user.id, reason: 'expired' },
    );
  });
});

describe('GameGateway presence expiry errors', () => {
  it('logs and reports to Sentry when removing an expired member fails', async () => {
    const { gateway, presence, membership } = makeDeps();
    const boom = new Error('db down');
    membership.leave.mockRejectedValue(boom);
    const logger = jest
      .spyOn(
        (gateway as unknown as { logger: { error: (e: unknown) => void } })
          .logger,
        'error',
      )
      .mockImplementation(() => undefined);
    (Sentry.captureException as jest.Mock).mockClear();
    gateway.afterInit({ use: jest.fn() } as never);

    const onExpired = presence.setExpiryHandler.mock.calls[0][0];
    onExpired('ABC123', user.id);
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger).toHaveBeenCalledWith(boom);
    expect(Sentry.captureException).toHaveBeenCalledWith(boom);
  });
});

describe('GameGateway.handleDisconnect', () => {
  it('does nothing when the socket never joined a room', () => {
    const { gateway, publisher } = makeDeps();
    const { socket } = makeSocket(user);

    gateway.handleDisconnect(asGatewaySocket(socket));

    expect(publisher.toRoom).not.toHaveBeenCalled();
  });

  it('announces a disconnect once the user goes fully offline', () => {
    const { gateway, presence, publisher } = makeDeps();
    presence.disconnect.mockReturnValue({ offline: true });
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';

    gateway.handleDisconnect(asGatewaySocket(socket));

    expect(publisher.toRoom).toHaveBeenCalledWith(
      'ABC123',
      ServerEvents.MEMBER_LEFT,
      { userId: user.id, reason: 'disconnected' },
    );
  });

  it('stays quiet while the user still has another live socket', () => {
    const { gateway, presence, publisher } = makeDeps();
    presence.disconnect.mockReturnValue({ offline: false });
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';

    gateway.handleDisconnect(asGatewaySocket(socket));

    expect(publisher.toRoom).not.toHaveBeenCalled();
  });
});

describe('GameGateway.onWatch / handle() wrapper', () => {
  it('returns the public room list and joins the public channel', async () => {
    const { gateway, rooms } = makeDeps();
    rooms.listPublic.mockResolvedValue([{ code: 'ABC123' }]);
    const { socket } = makeSocket(user);

    const ack = await gateway.onWatch(asGatewaySocket(socket), {});

    expect(ack).toEqual({ ok: true, data: [{ code: 'ABC123' }] });
    expect(socket.join).toHaveBeenCalledWith('public-rooms');
  });

  it('rejects a payload that fails schema validation', async () => {
    const { gateway } = makeDeps();
    const { socket } = makeSocket(user);

    const ack = await gateway.onWatch(asGatewaySocket(socket), {
      unexpected: true,
    });

    expect(ack).toEqual({
      ok: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Dados inválidos' },
    });
  });

  it('maps a thrown DomainError to its error code', async () => {
    const { gateway, rooms } = makeDeps();
    rooms.listPublic.mockRejectedValue(
      new DomainError('NOT_FOUND', 'Sala não encontrada'),
    );
    const { socket } = makeSocket(user);

    const ack = await gateway.onWatch(asGatewaySocket(socket), {});

    expect(ack).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Sala não encontrada' },
    });
  });

  it('hides unexpected errors behind an INTERNAL code and logs them', async () => {
    const { gateway, rooms } = makeDeps();
    const boom = new Error('db down');
    rooms.listPublic.mockRejectedValue(boom);
    const logger = jest
      .spyOn(
        (gateway as unknown as { logger: { error: (e: unknown) => void } })
          .logger,
        'error',
      )
      .mockImplementation(() => undefined);
    const { socket } = makeSocket(user);

    const ack = await gateway.onWatch(asGatewaySocket(socket), {});

    expect(ack).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Erro interno' },
    });
    expect(logger).toHaveBeenCalledWith(boom);
    expect(Sentry.captureException).toHaveBeenCalledWith(boom);
  });

  it('rate-limits a burst of calls from the same socket', async () => {
    const { gateway, rooms } = makeDeps();
    rooms.listPublic.mockResolvedValue([]);
    const { socket } = makeSocket(user);

    for (let i = 0; i < 10; i++)
      await gateway.onWatch(asGatewaySocket(socket), {});
    const ack = await gateway.onWatch(asGatewaySocket(socket), {});

    expect(ack).toEqual({
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'Calma! Muitas ações seguidas' },
    });
  });
});

describe('GameGateway.onJoin', () => {
  it('rejects joining a second room while already claiming one', async () => {
    const { gateway } = makeDeps();
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ZZZ234';
    socket.rooms.add(roomChannel('ZZZ234'));

    const ack = await gateway.onJoin(asGatewaySocket(socket), {
      code: 'AAA234',
    });

    expect(ack).toEqual({
      ok: false,
      error: {
        code: 'INVALID_STATE',
        message: 'Saia da sala atual antes de entrar em outra',
      },
    });
  });

  it('joins the room, builds a snapshot and announces the first socket', async () => {
    const snapshot = { members: [{ userId: user.id, nickname: 'Ana' }] };
    const deps = makeDepsWithConnect({ firstSocket: true, reconnected: false });
    deps.membership.join.mockResolvedValue(undefined);
    deps.snapshots.build.mockResolvedValue(snapshot);
    const { socket, emit } = makeSocket(user);

    const ack = await deps.gateway.onJoin(asGatewaySocket(socket), {
      code: 'AAA234',
    });

    expect(ack).toEqual({ ok: true, data: snapshot });
    expect(socket.join).toHaveBeenCalledWith(roomChannel('AAA234'));
    expect(socket.data.roomCode).toBe('AAA234');
    expect(emit).toHaveBeenCalledWith(ServerEvents.MEMBER_JOINED, {
      member: snapshot.members[0],
      reconnected: false,
    });
    expect(deps.publisher.publicRoomsChanged).toHaveBeenCalledTimes(1);
  });

  it('logs presence_reconnected when the user reconnects', async () => {
    const deps = makeDepsWithConnect({ firstSocket: true, reconnected: true });
    deps.membership.join.mockResolvedValue(undefined);
    deps.snapshots.build.mockResolvedValue({ members: [] });
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { socket } = makeSocket(user);

    await deps.gateway.onJoin(asGatewaySocket(socket), { code: 'AAA234' });

    expect(log).toHaveBeenCalledWith({
      event: 'presence_reconnected',
      roomCode: 'AAA234',
      userId: user.id,
    });
    log.mockRestore();
  });

  it('does not re-announce the member on a reconnect of an extra socket', async () => {
    const deps = makeDepsWithConnect({
      firstSocket: false,
      reconnected: false,
    });
    deps.membership.join.mockResolvedValue(undefined);
    deps.snapshots.build.mockResolvedValue({ members: [] });
    const { socket, emit } = makeSocket(user);

    await deps.gateway.onJoin(asGatewaySocket(socket), { code: 'AAA234' });

    expect(emit).not.toHaveBeenCalled();
    expect(deps.publisher.publicRoomsChanged).not.toHaveBeenCalled();
  });

  it('rejects with NOT_IN_ROOM when the socket disconnects mid-join', async () => {
    const deps = makeDepsWithConnect({ firstSocket: true, reconnected: false });
    deps.membership.join.mockImplementation(() => {
      socket.connected = false;
      return Promise.resolve();
    });
    const { socket } = makeSocket(user);

    const ack = await deps.gateway.onJoin(asGatewaySocket(socket), {
      code: 'AAA234',
    });

    expect(ack).toEqual({
      ok: false,
      error: {
        code: 'NOT_IN_ROOM',
        message: 'Conexão perdida durante a entrada na sala',
      },
    });
    expect(socket.data.joiningCode).toBeUndefined();
    expect(deps.presence.armOffline).toHaveBeenCalledWith('AAA234', user.id);
  });
});

function makeDepsWithConnect(connectResult: {
  firstSocket: boolean;
  reconnected: boolean;
}) {
  const deps = makeDeps();
  deps.presence.connect.mockReturnValue(connectResult);
  return deps;
}

describe('GameGateway.onLeave', () => {
  it('rejects when the socket is not in a room', async () => {
    const { gateway } = makeDeps();
    const { socket } = makeSocket(user);

    const ack = await gateway.onLeave(asGatewaySocket(socket), {});

    expect(ack).toEqual({
      ok: false,
      error: { code: 'NOT_IN_ROOM', message: 'Você não está em uma sala' },
    });
  });

  it('resets a stale roomCode when the socket already left the channel', async () => {
    const { gateway } = makeDeps();
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123'; // channel not in socket.rooms

    const ack = await gateway.onLeave(asGatewaySocket(socket), {});

    expect(ack.ok).toBe(false);
    expect(socket.data.roomCode).toBeUndefined();
  });

  it('removes the member and leaves the channel', async () => {
    const { gateway, membership, publisher, presence } = makeDeps();
    membership.leave.mockResolvedValue({ removed: true, closed: false });
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));

    const ack = await gateway.onLeave(asGatewaySocket(socket), {});

    expect(ack).toEqual({ ok: true, data: null });
    expect(membership.leave).toHaveBeenCalledWith('ABC123', user.id);
    expect(presence.remove).toHaveBeenCalledWith('ABC123', user.id);
    expect(publisher.toRoom).toHaveBeenCalledWith(
      'ABC123',
      ServerEvents.MEMBER_LEFT,
      { userId: user.id, reason: 'left' },
    );
    expect(socket.rooms.has(roomChannel('ABC123'))).toBe(false);
    expect(socket.data.roomCode).toBeUndefined();
  });

  it('announces a host change and room closure when leave() reports them', async () => {
    const { gateway, membership, publisher, presence } = makeDeps();
    membership.leave.mockResolvedValue({
      removed: true,
      closed: true,
      newHostId: 'new-host',
    });
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));

    await gateway.onLeave(asGatewaySocket(socket), {});

    expect(publisher.toRoom).toHaveBeenCalledWith(
      'ABC123',
      ServerEvents.HOST_CHANGED,
      { hostId: 'new-host' },
    );
    expect(publisher.toRoom).toHaveBeenCalledWith(
      'ABC123',
      ServerEvents.ROOM_CLOSED,
      { reason: 'empty' },
    );
    expect(presence.clearRoom).toHaveBeenCalledWith('ABC123');
  });

  it('does nothing when leave() reports the member was not removed', async () => {
    const { gateway, membership, publisher, presence } = makeDeps();
    membership.leave.mockResolvedValue({ removed: false, closed: false });
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));

    await gateway.onLeave(asGatewaySocket(socket), {});

    expect(presence.remove).not.toHaveBeenCalled();
    expect(publisher.toRoom).not.toHaveBeenCalled();
  });
});

describe('GameGateway.onKick', () => {
  it('kicks the target and tells everyone', async () => {
    const { gateway, membership, presence, publisher } = makeDeps();
    membership.kick.mockResolvedValue(undefined);
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));
    const targetId = randomUUID();

    const ack = await gateway.onKick(asGatewaySocket(socket), {
      userId: targetId,
    });

    expect(ack).toEqual({ ok: true, data: null });
    expect(membership.kick).toHaveBeenCalledWith('ABC123', user.id, targetId);
    expect(presence.remove).toHaveBeenCalledWith('ABC123', targetId);
    expect(publisher.toRoom).toHaveBeenCalledWith(
      'ABC123',
      ServerEvents.MEMBER_LEFT,
      { userId: targetId, reason: 'kicked' },
    );
    expect(publisher.removeUserFromRoom).toHaveBeenCalledWith(
      targetId,
      'ABC123',
    );
    expect(publisher.publicRoomsChanged).toHaveBeenCalledTimes(1);
  });
});

describe('GameGateway.onCancel', () => {
  it('cancels the room and tears down the channel', async () => {
    const { gateway, membership, presence, publisher } = makeDeps();
    membership.cancel.mockResolvedValue(undefined);
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));

    const ack = await gateway.onCancel(asGatewaySocket(socket), {});

    expect(ack).toEqual({ ok: true, data: null });
    expect(publisher.toRoom).toHaveBeenCalledWith(
      'ABC123',
      ServerEvents.ROOM_CLOSED,
      { reason: 'host_cancelled' },
    );
    expect(publisher.closeRoomChannel).toHaveBeenCalledWith('ABC123');
    expect(presence.clearRoom).toHaveBeenCalledWith('ABC123');
    expect(publisher.publicRoomsChanged).toHaveBeenCalledTimes(1);
  });
});

describe('GameGateway.onGenerate', () => {
  it('generates a card and announces the member is ready', async () => {
    const { gateway, membership, publisher } = makeDeps();
    const card = { id: 'c1', grid: [], marked: [] };
    membership.generateCard.mockResolvedValue(card);
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));

    const ack = await gateway.onGenerate(asGatewaySocket(socket), {});

    expect(ack).toEqual({ ok: true, data: card });
    expect(publisher.toRoom).toHaveBeenCalledWith(
      'ABC123',
      ServerEvents.MEMBER_READY,
      { userId: user.id },
    );
  });
});

describe('GameGateway.onStart', () => {
  it("delegates to the runner for the caller's room", async () => {
    const { gateway, runner } = makeDeps();
    runner.start.mockResolvedValue(undefined);
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));

    const ack = await gateway.onStart(asGatewaySocket(socket), {});

    expect(ack).toEqual({ ok: true, data: null });
    expect(runner.start).toHaveBeenCalledWith('ABC123', user.id);
  });
});

describe('GameGateway.onMark', () => {
  it('marks a cell and returns the updated list', async () => {
    const { gateway, games } = makeDeps();
    games.mark.mockResolvedValue([1, 2]);
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));

    const ack = await gateway.onMark(asGatewaySocket(socket), { index: 5 });

    expect(ack).toEqual({ ok: true, data: { marked: [1, 2] } });
    expect(games.mark).toHaveBeenCalledWith('ABC123', user.id, 5);
  });

  it('rejects an out-of-range index before calling the service', async () => {
    const { gateway, games } = makeDeps();
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));

    const ack = await gateway.onMark(asGatewaySocket(socket), { index: 99 });

    expect(ack).toEqual({
      ok: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Dados inválidos' },
    });
    expect(games.mark).not.toHaveBeenCalled();
  });
});

describe('GameGateway.onClaim', () => {
  it('stops the runner and announces the winner', async () => {
    const { gateway, games, runner, publisher } = makeDeps();
    const winner = {
      userId: user.id,
      nickname: 'Ana',
      pointsAwarded: 20,
      grid: [],
    };
    games.claim.mockResolvedValue({ gameId: 'g1', winner });
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));

    const ack = await gateway.onClaim(asGatewaySocket(socket), {});

    expect(log).toHaveBeenCalledWith({
      event: 'bingo_won',
      roomCode: 'ABC123',
      gameId: 'g1',
      userId: user.id,
    });
    log.mockRestore();

    expect(ack).toEqual({ ok: true, data: winner });
    expect(runner.stop).toHaveBeenCalledWith('g1');
    expect(publisher.toRoom).toHaveBeenCalledWith(
      'ABC123',
      ServerEvents.GAME_WON,
      winner,
    );
    expect(publisher.publicRoomsChanged).toHaveBeenCalledTimes(1);
  });

  it('logs bingo_rejected when the claim is invalid', async () => {
    const { gateway, games } = makeDeps();
    games.claim.mockRejectedValue(
      new DomainError('BINGO_INVALID', 'Cartela sem bingo'),
    );
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));

    const ack = await gateway.onClaim(asGatewaySocket(socket), {});

    expect(ack).toMatchObject({ ok: false, error: { code: 'BINGO_INVALID' } });
    expect(warn).toHaveBeenCalledWith({
      event: 'bingo_rejected',
      roomCode: 'ABC123',
      userId: user.id,
    });
    warn.mockRestore();
  });

  it('enforces its own, stricter rate limit bucket', async () => {
    const { gateway, games } = makeDeps();
    games.claim.mockResolvedValue({
      gameId: 'g1',
      winner: { userId: user.id, nickname: 'Ana', pointsAwarded: 0, grid: [] },
    });
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));

    await gateway.onClaim(asGatewaySocket(socket), {});
    const second = await gateway.onClaim(asGatewaySocket(socket), {});

    expect(second).toEqual({
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'Calma! Muitas ações seguidas' },
    });
  });
});

describe('GameGateway.onReplay', () => {
  it('rejects a replay from someone who is not the host', async () => {
    const { gateway, membership, runner } = makeDeps();
    membership.assertHost.mockRejectedValue(
      new DomainError('NOT_HOST', 'Só o host pode fazer isso'),
    );
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));

    const ack = await gateway.onReplay(asGatewaySocket(socket), {});

    expect(membership.assertHost).toHaveBeenCalledWith('ABC123', user.id);
    expect(ack).toEqual({
      ok: false,
      error: { code: 'NOT_HOST', message: 'Só o host pode fazer isso' },
    });
    expect(runner.broadcastSnapshots).not.toHaveBeenCalled();
  });

  it('rejects a replay while the previous game has not finished', async () => {
    const { gateway, membership } = makeDeps();
    membership.assertHost.mockResolvedValue({ status: 'IN_GAME' });
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));

    const ack = await gateway.onReplay(asGatewaySocket(socket), {});

    expect(ack).toEqual({
      ok: false,
      error: {
        code: 'INVALID_STATE',
        message: 'A partida ainda não terminou',
      },
    });
  });

  it('rebroadcasts fresh snapshots once the room is back to WAITING', async () => {
    const { gateway, membership, runner } = makeDeps();
    membership.assertHost.mockResolvedValue({ status: 'WAITING' });
    const { socket } = makeSocket(user);
    socket.data.roomCode = 'ABC123';
    socket.rooms.add(roomChannel('ABC123'));

    const ack = await gateway.onReplay(asGatewaySocket(socket), {});

    expect(ack).toEqual({ ok: true, data: null });
    expect(runner.broadcastSnapshots).toHaveBeenCalledWith('ABC123');
  });
});

describe('ClientEvents wiring sanity', () => {
  it('uses the documented event name for room:join', () => {
    expect(ClientEvents.ROOM_JOIN).toBe('room:join');
  });
});

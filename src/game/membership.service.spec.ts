import { CARD_COST, MAX_CARD_REGENS } from '../contracts';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../core/prisma.service';
import type { RandomInt } from '../core/random';
import { MembershipService } from './membership.service';

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: '0.0.0',
  });
}

function makePrisma() {
  const models = {
    // updateMany = cobrança da cartela (saldo suficiente por padrão)
    profile: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    coinTransaction: { create: jest.fn() },
    room: { findUnique: jest.fn(), update: jest.fn() },
    roomMember: {
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    card: {
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    game: { updateMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  return {
    ...models,
    $transaction: jest.fn(
      (arg: ((tx: typeof models) => unknown) | Promise<unknown>[]) => {
        if (typeof arg === 'function') return arg(models);
        return Promise.all(arg);
      },
    ),
  };
}

const random: RandomInt = () => 0;

describe('MembershipService.join', () => {
  it('requires a nickname before joining', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: null });
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.join('ABC123', 'u1')).rejects.toMatchObject({
      code: 'NICKNAME_REQUIRED',
    });
  });

  it('rejects when the room does not exist or is closed', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: 'Ana' });
    prisma.room.findUnique.mockResolvedValue(null);
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.join('ABC123', 'u1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('is a no-op if the user is already a member', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: 'Ana' });
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'WAITING',
      maxPlayers: 10,
    });
    prisma.roomMember.findMany.mockResolvedValue([{ userId: 'u1', slot: 0 }]);
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.join('ABC123', 'u1')).resolves.toBeUndefined();
    expect(prisma.roomMember.create).not.toHaveBeenCalled();
  });

  it('rejects joining a room whose game already started', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: 'Ana' });
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'IN_GAME',
      maxPlayers: 10,
    });
    prisma.roomMember.findMany.mockResolvedValue([]);
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.join('ABC123', 'u1')).rejects.toMatchObject({
      code: 'GAME_IN_PROGRESS',
    });
  });

  it('rejects joining a full room', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: 'Ana' });
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'WAITING',
      maxPlayers: 2,
    });
    prisma.roomMember.findMany.mockResolvedValue([
      { userId: 'a', slot: 0 },
      { userId: 'b', slot: 1 },
    ]);
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.join('ABC123', 'u1')).rejects.toMatchObject({
      code: 'ROOM_FULL',
    });
  });

  it('joins at the first free slot', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: 'Ana' });
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'WAITING',
      maxPlayers: 10,
    });
    prisma.roomMember.findMany.mockResolvedValue([{ userId: 'a', slot: 0 }]);
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await service.join('ABC123', 'u1');

    expect(prisma.roomMember.create).toHaveBeenCalledWith({
      data: { roomId: 'r1', userId: 'u1', slot: 1 },
    });
  });

  it('retries the slot assignment on a unique-constraint collision', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: 'Ana' });
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'WAITING',
      maxPlayers: 10,
    });
    prisma.roomMember.findMany.mockResolvedValue([]);
    prisma.roomMember.create
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce(undefined);
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.join('ABC123', 'u1')).resolves.toBeUndefined();
    expect(prisma.roomMember.create).toHaveBeenCalledTimes(2);
  });

  it('gives up with ROOM_FULL after exhausting all join attempts', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: 'Ana' });
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'WAITING',
      maxPlayers: 10,
    });
    prisma.roomMember.findMany.mockResolvedValue([]);
    prisma.roomMember.create.mockRejectedValue(uniqueViolation());
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.join('ABC123', 'u1')).rejects.toMatchObject({
      code: 'ROOM_FULL',
    });
    expect(prisma.roomMember.create).toHaveBeenCalledTimes(5);
  });

  it('rethrows a database error unrelated to a unique-constraint collision', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: 'Ana' });
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'WAITING',
      maxPlayers: 10,
    });
    prisma.roomMember.findMany.mockResolvedValue([]);
    const boom = new Error('db down');
    prisma.roomMember.create.mockRejectedValue(boom);
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.join('ABC123', 'u1')).rejects.toBe(boom);
  });
});

describe('MembershipService.leave', () => {
  it('no-ops when the room is missing or closed', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([]);
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.leave('ABC123', 'u1')).resolves.toEqual({
      removed: false,
      closed: false,
    });
  });

  it('no-ops when the caller is not a member', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([
      { id: 'r1', hostId: 'host', status: 'WAITING' },
    ]);
    prisma.roomMember.deleteMany.mockResolvedValue({ count: 0 });
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.leave('ABC123', 'u1')).resolves.toEqual({
      removed: false,
      closed: false,
    });
  });

  it('closes the room when the last member leaves', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([
      { id: 'r1', hostId: 'u1', status: 'WAITING' },
    ]);
    prisma.roomMember.deleteMany.mockResolvedValue({ count: 1 });
    prisma.roomMember.findMany.mockResolvedValue([]);
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.leave('ABC123', 'u1')).resolves.toEqual({
      removed: true,
      closed: true,
    });
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'CLOSED' },
    });
    expect(prisma.game.updateMany).toHaveBeenCalledWith({
      where: { roomId: 'r1', status: 'IN_PROGRESS' },
      data: {
        status: 'CANCELLED',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        finishedAt: expect.any(Date),
      },
    });
  });

  it('transfers host to the earliest remaining member when the host leaves', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([
      { id: 'r1', hostId: 'u1', status: 'WAITING' },
    ]);
    prisma.roomMember.deleteMany.mockResolvedValue({ count: 1 });
    prisma.roomMember.findMany.mockResolvedValue([
      { userId: 'u2', joinedAt: new Date('2024-01-01') },
    ]);
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.leave('ABC123', 'u1')).resolves.toEqual({
      removed: true,
      closed: false,
      newHostId: 'u2',
    });
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { hostId: 'u2' },
    });
  });

  it('leaves the host unchanged when a non-host member leaves', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([
      { id: 'r1', hostId: 'host', status: 'WAITING' },
    ]);
    prisma.roomMember.deleteMany.mockResolvedValue({ count: 1 });
    prisma.roomMember.findMany.mockResolvedValue([
      { userId: 'host', joinedAt: new Date('2024-01-01') },
    ]);
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.leave('ABC123', 'guest')).resolves.toEqual({
      removed: true,
      closed: false,
    });
    expect(prisma.room.update).not.toHaveBeenCalled();
  });
});

describe('MembershipService.kick', () => {
  it('requires the caller to be the host', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      hostId: 'host',
      status: 'WAITING',
    });
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(
      service.kick('ABC123', 'not-host', 'target'),
    ).rejects.toMatchObject({ code: 'NOT_HOST' });
  });

  it('rejects the host trying to kick themselves', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      hostId: 'host',
      status: 'WAITING',
    });
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.kick('ABC123', 'host', 'host')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('removes the target member via leave()', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      hostId: 'host',
      status: 'WAITING',
    });
    prisma.$queryRaw.mockResolvedValue([
      { id: 'r1', hostId: 'host', status: 'WAITING' },
    ]);
    prisma.roomMember.deleteMany.mockResolvedValue({ count: 1 });
    prisma.roomMember.findMany.mockResolvedValue([
      { userId: 'host', joinedAt: new Date() },
    ]);
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.kick('ABC123', 'host', 'target')).resolves.toEqual({
      removed: true,
      closed: false,
    });
  });
});

describe('MembershipService.cancel', () => {
  it('requires the caller to be the host', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      hostId: 'host',
      status: 'WAITING',
    });
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.cancel('ABC123', 'not-host')).rejects.toMatchObject({
      code: 'NOT_HOST',
    });
  });

  it('closes the room and cancels its in-progress game', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      hostId: 'host',
      status: 'IN_GAME',
    });
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await service.cancel('ABC123', 'host');

    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'CLOSED' },
    });
    expect(prisma.game.updateMany).toHaveBeenCalledWith({
      where: { roomId: 'r1', status: 'IN_PROGRESS' },
      data: {
        status: 'CANCELLED',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        finishedAt: expect.any(Date),
      },
    });
  });
});

describe('MembershipService.generateCard', () => {
  it('rejects once the game has started', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({ id: 'r1', status: 'IN_GAME' });
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.generateCard('ABC123', 'u1')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('rejects a caller who is not a room member', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({ id: 'r1', status: 'WAITING' });
    prisma.roomMember.findUnique.mockResolvedValue(null);
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.generateCard('ABC123', 'u1')).rejects.toMatchObject({
      code: 'NOT_IN_ROOM',
    });
  });

  it('creates a fresh card when the member has none yet', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({ id: 'r1', status: 'WAITING' });
    prisma.roomMember.findUnique.mockResolvedValue({ cardRegens: 0 });
    prisma.card.findFirst.mockResolvedValue(null);
    prisma.card.create.mockResolvedValue({ id: 'c1', grid: [1, 2, 3] });
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.generateCard('ABC123', 'u1')).resolves.toEqual({
      id: 'c1',
      grid: [1, 2, 3],
      marked: [],
    });
  });

  it('rejects regenerating past the regen limit', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({ id: 'r1', status: 'WAITING' });
    prisma.roomMember.findUnique.mockResolvedValue({
      cardRegens: MAX_CARD_REGENS,
    });
    prisma.card.findFirst.mockResolvedValue({ id: 'c1' });
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.generateCard('ABC123', 'u1')).rejects.toMatchObject({
      code: 'REGEN_LIMIT',
    });
  });

  it('regenerates the existing card and bumps the regen counter', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({ id: 'r1', status: 'WAITING' });
    prisma.roomMember.findUnique.mockResolvedValue({
      cardRegens: MAX_CARD_REGENS - 1,
    });
    prisma.card.findFirst.mockResolvedValue({ id: 'c1' });
    prisma.card.update.mockImplementation(() =>
      Promise.resolve({ id: 'c1', grid: [9, 9, 9] }),
    );
    prisma.roomMember.update.mockResolvedValue(undefined);
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.generateCard('ABC123', 'u1')).resolves.toEqual({
      id: 'c1',
      grid: [9, 9, 9],
      marked: [],
    });
    expect(prisma.roomMember.update).toHaveBeenCalledWith({
      where: { roomId_userId: { roomId: 'r1', userId: 'u1' } },
      data: { cardRegens: { increment: 1 } },
    });
  });

  it('charges CARD_COST coins for every card, first one and regenerations', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({ id: 'r1', status: 'WAITING' });
    prisma.roomMember.findUnique.mockResolvedValue({ cardRegens: 0 });
    prisma.card.findFirst.mockResolvedValue(null);
    prisma.card.create.mockResolvedValue({ id: 'c1', grid: [1] });
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await service.generateCard('ABC123', 'u1');
    expect(prisma.profile.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', coins: { gte: CARD_COST } },
      data: { coins: { decrement: CARD_COST } },
    });
    expect(prisma.coinTransaction.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        amount: -CARD_COST,
        reason: 'CARD',
        gameId: undefined,
      },
    });
  });

  it('refuses the card without enough coins and creates nothing', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({ id: 'r1', status: 'WAITING' });
    prisma.roomMember.findUnique.mockResolvedValue({ cardRegens: 0 });
    prisma.card.findFirst.mockResolvedValue(null);
    prisma.profile.updateMany.mockResolvedValue({ count: 0 });
    const service = new MembershipService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.generateCard('ABC123', 'u1')).rejects.toMatchObject({
      code: 'INSUFFICIENT_COINS',
    });
    expect(prisma.card.create).not.toHaveBeenCalled();
  });
});

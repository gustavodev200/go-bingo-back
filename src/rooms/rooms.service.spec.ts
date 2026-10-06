import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../core/prisma.service';
import type { RandomInt } from '../core/random';
import type { PresenceService } from '../game/presence.service';
import { RoomsService } from './rooms.service';

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: '0.0.0',
  });
}

function makePrisma() {
  return {
    profile: { findUnique: jest.fn() },
    room: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  };
}

const input = { name: 'Amigos', maxPlayers: 15 as const, isPublic: true };
const random: RandomInt = () => 0;

describe('RoomsService', () => {
  it('create() requires a nickname before creating a room', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: null });
    const service = new RoomsService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.create('host', input)).rejects.toMatchObject({
      code: 'NICKNAME_REQUIRED',
    });
    expect(prisma.room.create).not.toHaveBeenCalled();
  });

  it('create() generates a code and creates the room with the host as slot 0', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: 'Host' });
    prisma.room.create.mockResolvedValue({ id: 'room-1' });
    const service = new RoomsService(
      prisma as unknown as PrismaService,
      random,
    );

    const result = await service.create('host', input);

    expect(result.code).toHaveLength(6);
    expect(prisma.room.create).toHaveBeenCalledWith({
      data: {
        ...input,
        code: result.code,
        hostId: 'host',
        members: { create: { userId: 'host', slot: 0 } },
      },
    });
  });

  it('create() arms a presence grace window for the host, who has no socket yet', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: 'Host' });
    prisma.room.create.mockResolvedValue({ id: 'room-1' });
    const presence = { armOffline: jest.fn() };
    const service = new RoomsService(
      prisma as unknown as PrismaService,
      random,
      presence as unknown as PresenceService,
    );

    const result = await service.create('host', input);

    expect(presence.armOffline).toHaveBeenCalledWith(result.code, 'host');
  });

  it('create() works without a PresenceService (optional dependency)', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: 'Host' });
    prisma.room.create.mockResolvedValue({ id: 'room-1' });
    const service = new RoomsService(
      prisma as unknown as PrismaService,
      random,
    );

    const result = await service.create('host', input);

    expect(result.code).toHaveLength(6);
  });

  it('create() retries on a room-code collision and eventually succeeds', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: 'Host' });
    prisma.room.create
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce({ id: 'room-1' });
    const service = new RoomsService(
      prisma as unknown as PrismaService,
      random,
    );

    const result = await service.create('host', input);

    expect(prisma.room.create).toHaveBeenCalledTimes(2);
    expect(result.code).toHaveLength(6);
  });

  it('create() gives up with INTERNAL after exhausting all code attempts', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: 'Host' });
    prisma.room.create.mockRejectedValue(uniqueViolation());
    const service = new RoomsService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.create('host', input)).rejects.toMatchObject({
      code: 'INTERNAL',
    });
    expect(prisma.room.create).toHaveBeenCalledTimes(5);
  });

  it('create() rethrows an unrelated database error without retrying', async () => {
    const prisma = makePrisma();
    prisma.profile.findUnique.mockResolvedValue({ nickname: 'Host' });
    const boom = new Error('connection reset');
    prisma.room.create.mockRejectedValue(boom);
    const service = new RoomsService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.create('host', input)).rejects.toBe(boom);
    expect(prisma.room.create).toHaveBeenCalledTimes(1);
  });

  it('listPublic() maps rooms to their public summary shape', async () => {
    const prisma = makePrisma();
    prisma.room.findMany.mockResolvedValue([
      {
        code: 'ABC123',
        name: 'Sala',
        maxPlayers: 10,
        status: 'WAITING',
        _count: { members: 3 },
      },
    ]);
    const service = new RoomsService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.listPublic()).resolves.toEqual([
      {
        code: 'ABC123',
        name: 'Sala',
        playerCount: 3,
        maxPlayers: 10,
        status: 'WAITING',
      },
    ]);
  });

  it('summary() throws NOT_FOUND for a missing or closed room', async () => {
    const prisma = makePrisma();
    const service = new RoomsService(
      prisma as unknown as PrismaService,
      random,
    );

    prisma.room.findUnique.mockResolvedValue(null);
    await expect(service.summary('ABC123')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    prisma.room.findUnique.mockResolvedValue({ status: 'CLOSED' });
    await expect(service.summary('ABC123')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('summary() returns the public summary for an open room', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      code: 'ABC123',
      name: 'Sala',
      maxPlayers: 25,
      status: 'IN_GAME',
      _count: { members: 7 },
    });
    const service = new RoomsService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.summary('ABC123')).resolves.toEqual({
      code: 'ABC123',
      name: 'Sala',
      playerCount: 7,
      maxPlayers: 25,
      status: 'IN_GAME',
    });
  });
});

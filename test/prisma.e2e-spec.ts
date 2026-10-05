import { randomUUID } from 'node:crypto';
import { loadEnv } from '../src/core/env';
import { PrismaService } from '../src/core/prisma.service';
import { isUniqueViolation } from '../src/core/prisma-errors';

describe('PrismaService', () => {
  const prisma = new PrismaService(loadEnv());

  afterAll(() => prisma.$disconnect());
  beforeEach(() =>
    prisma.$executeRawUnsafe(
      'TRUNCATE "Draw","Card","Game","RoomMember","Room","Profile" CASCADE',
    ),
  );

  it('enforces one lobby card per player per room', async () => {
    const userId = randomUUID();
    await prisma.profile.create({ data: { id: userId } });
    const room = await prisma.room.create({
      data: {
        code: 'ABCDEF',
        name: 'Sala',
        hostId: userId,
        maxPlayers: 10,
        isPublic: true,
      },
    });
    const grid = Array.from({ length: 25 }, (_, i) => i);
    await prisma.card.create({ data: { roomId: room.id, userId, grid } });

    const error = await prisma.card
      .create({ data: { roomId: room.id, userId, grid } })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(error)).toBe(true);
  });

  it('rejects a repeated number in the same game', async () => {
    const userId = randomUUID();
    await prisma.profile.create({ data: { id: userId } });
    const room = await prisma.room.create({
      data: {
        code: 'GHJKLM',
        name: 'Sala',
        hostId: userId,
        maxPlayers: 10,
        isPublic: true,
      },
    });
    const game = await prisma.game.create({ data: { roomId: room.id } });
    await prisma.draw.create({ data: { gameId: game.id, seq: 1, number: 7 } });

    const error = await prisma.draw
      .create({ data: { gameId: game.id, seq: 2, number: 7 } })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(error)).toBe(true);
  });
});

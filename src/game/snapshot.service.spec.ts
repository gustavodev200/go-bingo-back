import type { PrismaService } from '../core/prisma.service';
import type { GamesService } from './games.service';
import type { PresenceService } from './presence.service';
import { SnapshotService } from './snapshot.service';

function makePrisma() {
  return {
    room: { findUnique: jest.fn() },
    game: { findFirst: jest.fn() },
    card: { findMany: jest.fn() },
  };
}

describe('SnapshotService.build', () => {
  it('rejects a missing or closed room', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue(null);
    const service = new SnapshotService(
      prisma as unknown as PrismaService,
      {} as unknown as GamesService,
      { connectedSet: jest.fn() } as unknown as PresenceService,
    );

    await expect(service.build('ABC123', 'u1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('builds a lobby snapshot with no active game', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      code: 'ABC123',
      name: 'Sala',
      hostId: 'host',
      maxPlayers: 10,
      isPublic: true,
      status: 'WAITING',
      drawIntervalMs: 5_000,
      members: [
        {
          userId: 'host',
          slot: 0,
          profile: { nickname: null, isGuest: false },
        },
        {
          userId: 'u1',
          slot: 1,
          profile: { nickname: 'Ana', isGuest: true },
        },
      ],
    });
    prisma.card.findMany.mockResolvedValue([
      { id: 'c1', userId: 'u1', grid: [1, 2], marked: [1, 1] },
    ]);
    const games = { drawnNumbers: jest.fn() };
    const connectedSet = jest.fn().mockReturnValue(new Set(['u1']));
    const service = new SnapshotService(
      prisma as unknown as PrismaService,
      games as unknown as GamesService,
      { connectedSet } as unknown as PresenceService,
    );

    const snapshot = await service.build('ABC123', 'u1');

    expect(prisma.game.findFirst).not.toHaveBeenCalled();
    expect(games.drawnNumbers).not.toHaveBeenCalled();
    expect(prisma.card.findMany).toHaveBeenCalledWith({
      where: { roomId: 'r1', gameId: null },
    });
    expect(snapshot.members).toEqual([
      {
        userId: 'host',
        nickname: 'Jogador',
        slot: 0,
        isGuest: false,
        connected: false,
        hasCard: false,
      },
      {
        userId: 'u1',
        nickname: 'Ana',
        slot: 1,
        isGuest: true,
        connected: true,
        hasCard: true,
      },
    ]);
    expect(snapshot.myCard).toEqual({ id: 'c1', grid: [1, 2], marked: [1] });
    expect(snapshot.game).toBeNull();
  });

  it('builds an in-game snapshot with the active game and remaining counts', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      code: 'ABC123',
      name: 'Sala',
      hostId: 'host',
      maxPlayers: 10,
      isPublic: false,
      status: 'IN_GAME',
      winPattern: 'LINE',
      drawIntervalMs: 5_000,
      members: [
        { userId: 'host', slot: 0, profile: { nickname: 'H', isGuest: false } },
      ],
    });
    prisma.game.findFirst.mockResolvedValue({ id: 'g1' });
    // Quina: coluna 0 (índices 0–4) com 1 e 2 sorteados → faltam 3
    const grid = Array.from({ length: 25 }, (_, i) => (i === 12 ? 0 : i + 1));
    prisma.card.findMany.mockResolvedValue([
      { id: 'c1', userId: 'host', grid, marked: [] },
    ]);
    const games = { drawnNumbers: jest.fn().mockResolvedValue([1, 2]) };
    const connectedSet = jest.fn().mockReturnValue(new Set());
    const service = new SnapshotService(
      prisma as unknown as PrismaService,
      games as unknown as GamesService,
      { connectedSet } as unknown as PresenceService,
    );

    const snapshot = await service.build('ABC123', 'host');

    expect(prisma.game.findFirst).toHaveBeenCalledWith({
      where: { roomId: 'r1', status: 'IN_PROGRESS' },
    });
    expect(games.drawnNumbers).toHaveBeenCalledWith('g1');
    expect(snapshot.winPattern).toBe('LINE');
    expect(snapshot.game).toEqual({
      id: 'g1',
      drawn: [1, 2],
      drawIntervalMs: 5_000,
      remaining: { host: 3 },
    });
  });

  it('returns null myCard when the viewer has none', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      code: 'ABC123',
      name: 'Sala',
      hostId: 'host',
      maxPlayers: 10,
      isPublic: true,
      status: 'WAITING',
      members: [],
    });
    prisma.card.findMany.mockResolvedValue([]);
    const service = new SnapshotService(
      prisma as unknown as PrismaService,
      {} as unknown as GamesService,
      {
        connectedSet: jest.fn().mockReturnValue(new Set()),
      } as unknown as PresenceService,
    );

    const snapshot = await service.build('ABC123', 'viewer-without-card');

    expect(snapshot.myCard).toBeNull();
  });
});

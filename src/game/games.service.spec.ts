import {
  CARD_COST,
  FREE_INDEX,
  LOSS_COINS,
  WIN_COINS,
  WIN_POINTS,
} from '../contracts';
import type { AuthUser } from '../core/auth/jwt-verifier';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../core/prisma.service';
import type { RandomInt } from '../core/random';
import { GamesService } from './games.service';

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: '0.0.0',
  });
}

/** Fake PrismaService where $transaction just runs the callback against the
 * same mock object, so `tx.model.method` and `prisma.model.method` hit the
 * exact same jest.fn()s. */
function makePrisma() {
  const models = {
    room: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    game: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    card: {
      updateMany: jest.fn(),
      createMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    coinTransaction: { create: jest.fn(), createMany: jest.fn() },
    // chargeUpTo (cobrança até zerar) devolve quanto tirou de cada um
    $queryRaw: jest.fn().mockResolvedValue([]),
    roomMember: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    profile: {
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    draw: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };
  return {
    ...models,
    $transaction: jest.fn((cb: (tx: typeof models) => unknown) => cb(models)),
  };
}

const random: RandomInt = () => 0;

describe('GamesService.start', () => {
  it('rejects when the room does not exist', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue(null);
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.start('ABC123', 'host')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects when the room is closed', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({ status: 'CLOSED' });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.start('ABC123', 'host')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects a non-host caller', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      hostId: 'host',
      status: 'WAITING',
      members: [],
      cards: [],
    });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.start('ABC123', 'intruder')).rejects.toMatchObject({
      code: 'NOT_HOST',
    });
  });

  it('rejects starting a room that already left WAITING', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      hostId: 'host',
      status: 'IN_GAME',
      members: [],
      cards: [],
    });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.start('ABC123', 'host')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('rejects with fewer than 2 members total', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      hostId: 'host',
      status: 'WAITING',
      members: [{ userId: 'host' }],
      cards: [{ userId: 'host' }],
    });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.start('ABC123', 'host')).rejects.toMatchObject({
      code: 'NOT_ENOUGH_PLAYERS',
    });
  });

  it('rejects when fewer than 2 members have a card', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      hostId: 'host',
      status: 'WAITING',
      members: [{ userId: 'host' }, { userId: 'guest' }],
      cards: [{ userId: 'host' }],
    });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.start('ABC123', 'host')).rejects.toMatchObject({
      code: 'NOT_ENOUGH_PLAYERS',
    });
  });

  it('rejects when another request already flipped the room out of WAITING', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      hostId: 'host',
      status: 'WAITING',
      members: [{ userId: 'host' }, { userId: 'guest' }],
      cards: [{ userId: 'host' }, { userId: 'guest' }],
      drawIntervalMs: 5_000,
    });
    prisma.room.updateMany.mockResolvedValue({ count: 0 });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.start('ABC123', 'host')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('starts the game, dealing cards only to members missing one', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      hostId: 'host',
      status: 'WAITING',
      members: [{ userId: 'host' }, { userId: 'guest' }, { userId: 'late' }],
      cards: [{ userId: 'host' }, { userId: 'guest' }],
      drawIntervalMs: 7_000,
    });
    prisma.room.updateMany.mockResolvedValue({ count: 1 });
    prisma.game.create.mockResolvedValue({ id: 'game-1' });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    const result = await service.start('ABC123', 'host');

    expect(result).toEqual({ gameId: 'game-1', drawIntervalMs: 7_000 });
    expect(prisma.card.updateMany).toHaveBeenCalledWith({
      where: {
        roomId: 'r1',
        gameId: null,
        userId: { in: ['host', 'guest', 'late'] },
      },
      data: { gameId: 'game-1' },
    });
    expect(prisma.card.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          roomId: 'r1',
          userId: 'late',
          gameId: 'game-1',
        }),
      ],
    });
    expect(prisma.roomMember.updateMany).toHaveBeenCalledWith({
      where: { roomId: 'r1' },
      data: { cardRegens: 0 },
    });
    expect(prisma.profile.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['host', 'guest', 'late'] } },
      data: { gamesPlayed: { increment: 1 } },
    });
    // a cartela automática do "late" também custa (até zerar o saldo)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw.mock.calls[0]).toEqual(
      expect.arrayContaining([['late'], CARD_COST]),
    );
  });

  it('skips dealing cards when every member already has one', async () => {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      hostId: 'host',
      status: 'WAITING',
      members: [{ userId: 'host' }, { userId: 'guest' }],
      cards: [{ userId: 'host' }, { userId: 'guest' }],
      drawIntervalMs: 5_000,
    });
    prisma.room.updateMany.mockResolvedValue({ count: 1 });
    prisma.game.create.mockResolvedValue({ id: 'game-1' });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await service.start('ABC123', 'host');

    expect(prisma.card.createMany).not.toHaveBeenCalled();
  });
});

describe('GamesService.drawNext', () => {
  it('reports stopped when the game no longer exists', async () => {
    const prisma = makePrisma();
    prisma.game.findUnique.mockResolvedValue(null);
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.drawNext('g1')).resolves.toEqual({ kind: 'stopped' });
  });

  it('reports stopped when the game is no longer IN_PROGRESS', async () => {
    const prisma = makePrisma();
    prisma.game.findUnique.mockResolvedValue({
      status: 'FINISHED',
      draws: [],
    });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.drawNext('g1')).resolves.toEqual({ kind: 'stopped' });
  });

  it('finishes the game and reopens the room once every number is drawn', async () => {
    const prisma = makePrisma();
    const drawn = Array.from({ length: 75 }, (_, i) => ({ number: i + 1 }));
    prisma.game.findUnique.mockResolvedValue({
      id: 'g1',
      roomId: 'r1',
      status: 'IN_PROGRESS',
      drawnCount: 75,
      draws: drawn,
    });
    prisma.game.updateMany.mockResolvedValue({ count: 1 });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.drawNext('g1')).resolves.toEqual({
      kind: 'exhausted',
    });
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'WAITING' },
    });
  });

  it('reports stopped if exhaustion lost a race with claim()/cancel()', async () => {
    const prisma = makePrisma();
    const drawn = Array.from({ length: 75 }, (_, i) => ({ number: i + 1 }));
    prisma.game.findUnique.mockResolvedValue({
      id: 'g1',
      roomId: 'r1',
      status: 'IN_PROGRESS',
      drawnCount: 75,
      draws: drawn,
    });
    prisma.game.updateMany.mockResolvedValue({ count: 0 });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.drawNext('g1')).resolves.toEqual({ kind: 'stopped' });
    expect(prisma.room.update).not.toHaveBeenCalled();
  });

  it('draws the next number and persists it', async () => {
    const prisma = makePrisma();
    prisma.game.findUnique.mockResolvedValue({
      id: 'g1',
      roomId: 'r1',
      status: 'IN_PROGRESS',
      drawnCount: 2,
      draws: [{ number: 1 }, { number: 2 }],
    });
    prisma.game.updateMany.mockResolvedValue({ count: 1 });
    prisma.draw.create.mockResolvedValue({
      drawnAt: new Date('2024-01-01T00:00:00.000Z'),
    });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      () => 0,
    );

    const result = await service.drawNext('g1');

    expect(result).toEqual({
      kind: 'drawn',
      draw: {
        seq: 3,
        number: 3,
        letter: 'B',
        drawnAt: '2024-01-01T00:00:00.000Z',
      },
    });
    expect(prisma.game.updateMany).toHaveBeenCalledWith({
      where: { id: 'g1', status: 'IN_PROGRESS', drawnCount: 2 },
      data: { drawnCount: 3 },
    });
  });

  it('skips the tick when a concurrent tick already advanced drawnCount', async () => {
    const prisma = makePrisma();
    prisma.game.findUnique.mockResolvedValue({
      id: 'g1',
      roomId: 'r1',
      status: 'IN_PROGRESS',
      drawnCount: 2,
      draws: [{ number: 1 }, { number: 2 }],
    });
    prisma.game.updateMany.mockResolvedValue({ count: 0 });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      () => 0,
    );

    await expect(service.drawNext('g1')).resolves.toEqual({ kind: 'skipped' });
    expect(prisma.draw.create).not.toHaveBeenCalled();
  });

  it('skips the tick when the draw collides on a unique constraint', async () => {
    const prisma = makePrisma();
    prisma.game.findUnique.mockResolvedValue({
      id: 'g1',
      roomId: 'r1',
      status: 'IN_PROGRESS',
      drawnCount: 2,
      draws: [{ number: 1 }, { number: 2 }],
    });
    prisma.game.updateMany.mockResolvedValue({ count: 1 });
    prisma.draw.create.mockRejectedValue(uniqueViolation());
    const service = new GamesService(
      prisma as unknown as PrismaService,
      () => 0,
    );

    await expect(service.drawNext('g1')).resolves.toEqual({ kind: 'skipped' });
  });

  it('rethrows unexpected errors from inside the transaction', async () => {
    const prisma = makePrisma();
    const boom = new Error('db down');
    prisma.game.findUnique.mockRejectedValue(boom);
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.drawNext('g1')).rejects.toBe(boom);
  });
});

describe('GamesService.mark', () => {
  function roomAndGame() {
    return {
      room: { id: 'r1', status: 'WAITING' },
      game: { id: 'g1', status: 'IN_PROGRESS' },
      member: { roomId: 'r1', userId: 'u1' },
    };
  }

  it('returns the marked list untouched for the free cell index', async () => {
    const prisma = makePrisma();
    const { room, game, member } = roomAndGame();
    prisma.room.findUnique.mockResolvedValue(room);
    prisma.game.findFirst.mockResolvedValue(game);
    prisma.roomMember.findUnique.mockResolvedValue(member);
    prisma.card.findUnique.mockResolvedValue({
      id: 'c1',
      grid: Array(25).fill(1),
      marked: [1, 2],
    });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.mark('ABC123', 'u1', FREE_INDEX)).resolves.toEqual([
      1, 2,
    ]);
    expect(prisma.draw.findUnique).not.toHaveBeenCalled();
  });

  it('returns the marked list untouched when the cell itself is the free cell', async () => {
    const prisma = makePrisma();
    const { room, game, member } = roomAndGame();
    prisma.room.findUnique.mockResolvedValue(room);
    prisma.game.findFirst.mockResolvedValue(game);
    prisma.roomMember.findUnique.mockResolvedValue(member);
    const grid = Array(25).fill(1);
    grid[3] = 0; // FREE_CELL duplicated outside the free index, for this test only
    prisma.card.findUnique.mockResolvedValue({ id: 'c1', grid, marked: [] });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.mark('ABC123', 'u1', 3)).resolves.toEqual([]);
    expect(prisma.draw.findUnique).not.toHaveBeenCalled();
  });

  it('is idempotent for an already-marked index', async () => {
    const prisma = makePrisma();
    const { room, game, member } = roomAndGame();
    prisma.room.findUnique.mockResolvedValue(room);
    prisma.game.findFirst.mockResolvedValue(game);
    prisma.roomMember.findUnique.mockResolvedValue(member);
    prisma.card.findUnique.mockResolvedValue({
      id: 'c1',
      grid: Array(25).fill(5),
      marked: [0],
    });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.mark('ABC123', 'u1', 0)).resolves.toEqual([0]);
    expect(prisma.card.update).not.toHaveBeenCalled();
  });

  it('rejects marking a number that has not been drawn', async () => {
    const prisma = makePrisma();
    const { room, game, member } = roomAndGame();
    prisma.room.findUnique.mockResolvedValue(room);
    prisma.game.findFirst.mockResolvedValue(game);
    prisma.roomMember.findUnique.mockResolvedValue(member);
    prisma.card.findUnique.mockResolvedValue({
      id: 'c1',
      grid: Array(25).fill(7),
      marked: [],
    });
    prisma.draw.findUnique.mockResolvedValue(null);
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.mark('ABC123', 'u1', 0)).rejects.toMatchObject({
      code: 'NOT_DRAWN',
    });
  });

  it('marks a drawn number and returns the deduplicated list', async () => {
    const prisma = makePrisma();
    const { room, game, member } = roomAndGame();
    prisma.room.findUnique.mockResolvedValue(room);
    prisma.game.findFirst.mockResolvedValue(game);
    prisma.roomMember.findUnique.mockResolvedValue(member);
    prisma.card.findUnique.mockResolvedValue({
      id: 'c1',
      grid: Array(25).fill(7),
      marked: [1],
    });
    prisma.draw.findUnique.mockResolvedValue({ number: 7 });
    prisma.card.update.mockResolvedValue({ marked: [1, 0, 0] });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.mark('ABC123', 'u1', 0)).resolves.toEqual([1, 0]);
    expect(prisma.card.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { marked: { push: 0 } },
    });
  });

  it('rejects when the room is missing, the game is not running, or the user has no card', async () => {
    const prisma = makePrisma();
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    prisma.room.findUnique.mockResolvedValue(null);
    await expect(service.mark('ABC123', 'u1', 0)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    prisma.room.findUnique.mockResolvedValue({ id: 'r1', status: 'WAITING' });
    prisma.game.findFirst.mockResolvedValue(null);
    await expect(service.mark('ABC123', 'u1', 0)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });

    prisma.game.findFirst.mockResolvedValue({ id: 'g1' });
    prisma.roomMember.findUnique.mockResolvedValue(null);
    await expect(service.mark('ABC123', 'u1', 0)).rejects.toMatchObject({
      code: 'NOT_IN_ROOM',
    });

    prisma.roomMember.findUnique.mockResolvedValue({ userId: 'u1' });
    prisma.card.findUnique.mockResolvedValue(null);
    await expect(service.mark('ABC123', 'u1', 0)).rejects.toMatchObject({
      code: 'NOT_IN_ROOM',
    });
  });
});

describe('GamesService.claim', () => {
  function setupActiveCard(
    prisma: ReturnType<typeof makePrisma>,
    winPattern: 'FULL_CARD' | 'LINE' = 'FULL_CARD',
  ) {
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'WAITING',
      winPattern,
    });
    prisma.game.findFirst.mockResolvedValue({
      id: 'g1',
      roomId: 'r1',
      status: 'IN_PROGRESS',
    });
    prisma.roomMember.findUnique.mockResolvedValue({ userId: 'u1' });
  }

  it('rejects a claim when numbers are still missing', async () => {
    const prisma = makePrisma();
    setupActiveCard(prisma);
    prisma.card.findUnique.mockResolvedValue({
      id: 'c1',
      grid: [1, 2, 3],
      marked: [],
    });
    prisma.draw.findMany.mockResolvedValue([{ number: 1 }]);
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );
    const user: AuthUser = { id: 'u1', isAnonymous: false };

    await expect(service.claim('ABC123', user)).rejects.toMatchObject({
      code: 'BINGO_INVALID',
    });
  });

  it('rejects when someone else already won in the same tick', async () => {
    const prisma = makePrisma();
    setupActiveCard(prisma);
    prisma.card.findUnique.mockResolvedValue({
      id: 'c1',
      grid: [1, 2],
      marked: [],
    });
    prisma.draw.findMany.mockResolvedValue([{ number: 1 }, { number: 2 }]);
    prisma.game.updateMany.mockResolvedValue({ count: 0 });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );
    const user: AuthUser = { id: 'u1', isAnonymous: false };

    await expect(service.claim('ABC123', user)).rejects.toMatchObject({
      code: 'BINGO_INVALID',
    });
  });

  it('awards points to a registered winner and reopens the room', async () => {
    const prisma = makePrisma();
    setupActiveCard(prisma);
    prisma.card.findUnique.mockResolvedValue({
      id: 'c1',
      grid: [1, 2],
      marked: [],
    });
    prisma.draw.findMany.mockResolvedValue([{ number: 1 }, { number: 2 }]);
    prisma.game.updateMany.mockResolvedValue({ count: 1 });
    prisma.profile.update.mockResolvedValue({ nickname: 'Fulano' });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );
    const user: AuthUser = { id: 'u1', isAnonymous: false };

    const result = await service.claim('ABC123', user);

    expect(result).toEqual({
      gameId: 'g1',
      winner: {
        userId: 'u1',
        nickname: 'Fulano',
        pointsAwarded: WIN_POINTS,
        coinsAwarded: WIN_COINS.FULL_CARD,
        grid: [1, 2],
      },
    });
    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { points: { increment: WIN_POINTS } },
    });
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'WAITING' },
    });
  });

  it('awards zero points to an anonymous winner, and falls back to "Jogador"', async () => {
    const prisma = makePrisma();
    setupActiveCard(prisma);
    prisma.card.findUnique.mockResolvedValue({
      id: 'c1',
      grid: [1, 2],
      marked: [],
    });
    prisma.draw.findMany.mockResolvedValue([{ number: 1 }, { number: 2 }]);
    prisma.game.updateMany.mockResolvedValue({ count: 1 });
    prisma.profile.update.mockResolvedValue({ nickname: null });
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );
    const user: AuthUser = { id: 'u1', isAnonymous: true };

    const result = await service.claim('ABC123', user);

    expect(result.winner.pointsAwarded).toBe(0);
    expect(result.winner.nickname).toBe('Jogador');
    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {},
    });
  });

  it('winner gets WIN_COINS (guests too); everyone else with a card loses up to LOSS_COINS', async () => {
    const prisma = makePrisma();
    setupActiveCard(prisma);
    prisma.card.findUnique.mockResolvedValue({
      id: 'c1',
      grid: [1, 2],
      marked: [],
    });
    prisma.draw.findMany.mockResolvedValue([{ number: 1 }, { number: 2 }]);
    prisma.game.updateMany.mockResolvedValue({ count: 1 });
    prisma.profile.update.mockResolvedValue({ nickname: 'Fulano' });
    prisma.card.findMany.mockResolvedValue([
      { userId: 'u2' },
      { userId: 'u3' },
    ]);
    prisma.$queryRaw.mockResolvedValue([
      { id: 'u2', charged: 20 },
      { id: 'u3', charged: 7 },
    ]);
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    const result = await service.claim('ABC123', {
      id: 'u1',
      isAnonymous: true,
    });

    expect(result.winner.coinsAwarded).toBe(WIN_COINS.FULL_CARD);
    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { coins: { increment: WIN_COINS.FULL_CARD } },
    });
    expect(prisma.card.findMany).toHaveBeenCalledWith({
      where: { gameId: 'g1', userId: { not: 'u1' } },
      select: { userId: true },
    });
    expect(prisma.$queryRaw.mock.calls[0]).toEqual(
      expect.arrayContaining([['u2', 'u3'], LOSS_COINS]),
    );
    expect(prisma.coinTransaction.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'u2', amount: -20, reason: 'LOSS', gameId: 'g1' },
        { userId: 'u3', amount: -7, reason: 'LOSS', gameId: 'g1' },
      ],
    });
  });
});

describe('GamesService.claim in Quina (LINE) rooms', () => {
  /** Grade coluna-major com números = índice + 1 e centro FREE. */
  const grid = Array.from({ length: 25 }, (_, i) =>
    i === FREE_INDEX ? 0 : i + 1,
  );

  function setup(drawn: number[]) {
    const prisma = makePrisma();
    prisma.room.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'IN_GAME',
      winPattern: 'LINE',
    });
    prisma.game.findFirst.mockResolvedValue({
      id: 'g1',
      roomId: 'r1',
      status: 'IN_PROGRESS',
    });
    prisma.roomMember.findUnique.mockResolvedValue({ userId: 'u1' });
    prisma.card.findUnique.mockResolvedValue({ id: 'c1', grid, marked: [] });
    prisma.draw.findMany.mockResolvedValue(drawn.map((number) => ({ number })));
    prisma.game.updateMany.mockResolvedValue({ count: 1 });
    prisma.profile.update.mockResolvedValue({ nickname: 'Fulano' });
    return {
      prisma,
      service: new GamesService(prisma as unknown as PrismaService, random),
    };
  }

  it('accepts a middle row through the free center with only 4 numbers and pays the Quina prize', async () => {
    // linha 2 (row = 2): índices 2, 7, 12 (FREE), 17, 22
    const { prisma, service } = setup([3, 8, 18, 23]);

    const result = await service.claim('ABC123', {
      id: 'u1',
      isAnonymous: false,
    });

    expect(result.winner.coinsAwarded).toBe(WIN_COINS.LINE);
    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { coins: { increment: WIN_COINS.LINE } },
    });
  });

  it('accepts a full column', async () => {
    const { service } = setup([1, 2, 3, 4, 5]);

    await expect(
      service.claim('ABC123', { id: 'u1', isAnonymous: false }),
    ).resolves.toBeDefined();
  });

  it('rejects scattered numbers that close no line', async () => {
    const { service } = setup([1, 7, 14, 20]);

    await expect(
      service.claim('ABC123', { id: 'u1', isAnonymous: false }),
    ).rejects.toMatchObject({ code: 'BINGO_INVALID' });
  });
});

describe('GamesService read helpers', () => {
  it('progress() counts the closest line in Quina rooms', async () => {
    const prisma = makePrisma();
    prisma.game.findUnique.mockResolvedValue({
      room: { winPattern: 'LINE' },
    });
    const grid = Array.from({ length: 25 }, (_, i) =>
      i === FREE_INDEX ? 0 : i + 1,
    );
    prisma.card.findMany.mockResolvedValue([{ userId: 'u1', grid }]);
    // diagonal 0, 6, 12 (FREE), 18, 24 → falta só o 25
    prisma.draw.findMany.mockResolvedValue([
      { number: 1 },
      { number: 7 },
      { number: 19 },
    ]);
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.progress('g1')).resolves.toEqual({ u1: 1 });
  });

  it('progress() maps remaining counts per player', async () => {
    const prisma = makePrisma();
    prisma.card.findMany.mockResolvedValue([
      { userId: 'u1', grid: [1, 2, 3] },
      { userId: 'u2', grid: [1, 2] },
    ]);
    prisma.draw.findMany.mockResolvedValue([{ number: 1 }]);
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.progress('g1')).resolves.toEqual({
      u1: 2,
      u2: 1,
    });
  });

  it('drawnNumbers() returns numbers ordered by sequence', async () => {
    const prisma = makePrisma();
    prisma.draw.findMany.mockResolvedValue([{ number: 5 }, { number: 12 }]);
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.drawnNumbers('g1')).resolves.toEqual([5, 12]);
    expect(prisma.draw.findMany).toHaveBeenCalledWith({
      where: { gameId: 'g1' },
      orderBy: { seq: 'asc' },
      select: { number: true },
    });
  });

  it('findInProgress() maps running games to their room code and interval', async () => {
    const prisma = makePrisma();
    prisma.game.findMany.mockResolvedValue([
      {
        id: 'g1',
        room: { code: 'ABC123', drawIntervalMs: 5_000 },
      },
    ]);
    const service = new GamesService(
      prisma as unknown as PrismaService,
      random,
    );

    await expect(service.findInProgress()).resolves.toEqual([
      { id: 'g1', roomCode: 'ABC123', drawIntervalMs: 5_000 },
    ]);
  });
});

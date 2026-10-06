import { ServerEvents } from '../contracts';
import type { PrismaService } from '../core/prisma.service';
import { GameRunner } from './game-runner.service';
import type { GamesService } from './games.service';
import type { RealtimePublisher } from './realtime-publisher';
import type { SnapshotService } from './snapshot.service';

function makeDeps() {
  const games = {
    start: jest.fn(),
    drawNext: jest.fn(),
    progress: jest.fn(),
    findInProgress: jest.fn(),
  };
  const snapshots = { build: jest.fn() };
  const publisher = {
    toRoom: jest.fn(),
    toUser: jest.fn(),
    publicRoomsChanged: jest.fn(),
  };
  const prisma = { roomMember: { findMany: jest.fn().mockResolvedValue([]) } };
  let nextHandle = 0;
  const timer = {
    set: jest.fn(() => ++nextHandle),
    clear: jest.fn(),
  };
  const runner = new GameRunner(
    games as unknown as GamesService,
    snapshots as unknown as SnapshotService,
    publisher as unknown as RealtimePublisher,
    prisma as unknown as PrismaService,
    timer,
  );
  return { runner, games, snapshots, publisher, prisma, timer };
}

describe('GameRunner.start', () => {
  it('announces the game, broadcasts snapshots and schedules the first tick', async () => {
    const { runner, games, publisher, timer } = makeDeps();
    games.start.mockResolvedValue({ gameId: 'g1', drawIntervalMs: 5_000 });

    await runner.start('ABC123', 'host');

    expect(games.start).toHaveBeenCalledWith('ABC123', 'host');
    expect(publisher.toRoom).toHaveBeenCalledWith(
      'ABC123',
      ServerEvents.GAME_STARTED,
      { gameId: 'g1', drawIntervalMs: 5_000 },
    );
    expect(publisher.publicRoomsChanged).toHaveBeenCalledTimes(1);
    expect(timer.set).toHaveBeenCalledWith(expect.any(Function), 5_000);
  });
});

describe('GameRunner.tick', () => {
  it('broadcasts a draw and reschedules', async () => {
    const { runner, games, publisher, timer } = makeDeps();
    games.drawNext.mockResolvedValue({
      kind: 'drawn',
      draw: { seq: 1, number: 7, letter: 'B', drawnAt: 'now' },
    });
    games.progress.mockResolvedValue({ u1: 10 });

    await runner.tick('g1', 'ABC123', 5_000);

    expect(publisher.toRoom).toHaveBeenCalledWith(
      'ABC123',
      ServerEvents.NUMBER_DRAWN,
      { seq: 1, number: 7, letter: 'B', drawnAt: 'now' },
    );
    expect(publisher.toRoom).toHaveBeenCalledWith(
      'ABC123',
      ServerEvents.GAME_PROGRESS,
      { remaining: { u1: 10 } },
    );
    expect(timer.set).toHaveBeenCalledTimes(1);
  });

  it('reschedules without broadcasting on a skipped tick', async () => {
    const { runner, games, publisher, timer } = makeDeps();
    games.drawNext.mockResolvedValue({ kind: 'skipped' });

    await runner.tick('g1', 'ABC123', 5_000);

    expect(publisher.toRoom).not.toHaveBeenCalled();
    expect(timer.set).toHaveBeenCalledTimes(1);
  });

  it('announces the end of the game and does not reschedule when exhausted', async () => {
    const { runner, games, publisher, timer } = makeDeps();
    games.drawNext.mockResolvedValue({ kind: 'exhausted' });

    await runner.tick('g1', 'ABC123', 5_000);

    expect(publisher.toRoom).toHaveBeenCalledWith(
      'ABC123',
      ServerEvents.GAME_ENDED,
      { reason: 'exhausted' },
    );
    expect(publisher.publicRoomsChanged).toHaveBeenCalledTimes(1);
    expect(timer.set).not.toHaveBeenCalled();
  });

  it('does nothing further for a stopped game', async () => {
    const { runner, games, publisher, timer } = makeDeps();
    games.drawNext.mockResolvedValue({ kind: 'stopped' });

    await runner.tick('g1', 'ABC123', 5_000);

    expect(publisher.toRoom).not.toHaveBeenCalled();
    expect(publisher.publicRoomsChanged).not.toHaveBeenCalled();
    expect(timer.set).not.toHaveBeenCalled();
  });

  it('logs and reschedules when drawNext() throws', async () => {
    const { runner, games, timer } = makeDeps();
    const boom = new Error('db down');
    games.drawNext.mockRejectedValue(boom);
    const logger = jest
      .spyOn(
        (runner as unknown as { logger: { error: (e: unknown) => void } })
          .logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await runner.tick('g1', 'ABC123', 5_000);

    expect(logger).toHaveBeenCalledWith(boom);
    expect(timer.set).toHaveBeenCalledTimes(1);
  });
});

describe('GameRunner.stop', () => {
  it('clears a scheduled timer', async () => {
    const { runner, games, timer } = makeDeps();
    games.start.mockResolvedValue({ gameId: 'g1', drawIntervalMs: 5_000 });
    await runner.start('ABC123', 'host');

    runner.stop('g1');

    expect(timer.clear).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for a game with no scheduled timer', () => {
    const { runner, timer } = makeDeps();
    runner.stop('unknown');
    expect(timer.clear).not.toHaveBeenCalled();
  });
});

describe('GameRunner.broadcastSnapshots', () => {
  it('sends a fresh snapshot to every room member', async () => {
    const { runner, prisma, snapshots, publisher } = makeDeps();
    prisma.roomMember.findMany.mockResolvedValue([
      { userId: 'u1' },
      { userId: 'u2' },
    ]);
    snapshots.build.mockImplementation((code: string, userId: string) =>
      Promise.resolve({ code, userId }),
    );

    await runner.broadcastSnapshots('ABC123');

    expect(publisher.toUser).toHaveBeenCalledWith(
      'u1',
      ServerEvents.ROOM_STATE,
      { code: 'ABC123', userId: 'u1' },
    );
    expect(publisher.toUser).toHaveBeenCalledWith(
      'u2',
      ServerEvents.ROOM_STATE,
      { code: 'ABC123', userId: 'u2' },
    );
  });
});

describe('GameRunner.onApplicationBootstrap', () => {
  it('reschedules every game that was in progress before the restart', async () => {
    const { runner, games, timer } = makeDeps();
    games.findInProgress.mockResolvedValue([
      { id: 'g1', roomCode: 'ABC123', drawIntervalMs: 5_000 },
      { id: 'g2', roomCode: 'DEF456', drawIntervalMs: 3_000 },
    ]);

    await runner.onApplicationBootstrap();

    expect(timer.set).toHaveBeenCalledTimes(2);
  });

  it('schedules nothing when no game was in progress', async () => {
    const { runner, games, timer } = makeDeps();
    games.findInProgress.mockResolvedValue([]);

    await runner.onApplicationBootstrap();

    expect(timer.set).not.toHaveBeenCalled();
  });
});

describe('GameRunner.onModuleDestroy', () => {
  it('stops every timer that is still scheduled', async () => {
    const { runner, games, timer } = makeDeps();
    games.start.mockResolvedValue({ gameId: 'g1', drawIntervalMs: 5_000 });
    await runner.start('ABC123', 'host');

    runner.onModuleDestroy();

    expect(timer.clear).toHaveBeenCalledTimes(1);
  });
});

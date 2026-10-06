import { GameRunner } from '../src/game/game-runner.service';
import { DRAW_TIMER, type DrawTimer } from '../src/game/draw-timer';
import { GamesService } from '../src/game/games.service';
import { MembershipService } from '../src/game/membership.service';
import { createTestApp, TestApp } from './support/app';
import { makeRoom, makeUser } from './support/factories';

describe('GameRunner', () => {
  let t: TestApp;
  const scheduled: Array<{ fn: () => void; ms: number }> = [];
  const timer: DrawTimer = {
    set: (fn, ms) => scheduled.push({ fn, ms }),
    clear: () => undefined,
  };

  beforeAll(
    async () =>
      (t = await createTestApp([{ token: DRAW_TIMER, value: timer }])),
  );
  afterAll(() => t.app.close());
  beforeEach(async () => {
    scheduled.length = 0;
    await t.resetDb();
  });

  async function startedGame() {
    const host = await makeUser(t, 'Host');
    const p1 = await makeUser(t, 'Ana');
    const room = await makeRoom(t, host.id);
    const membership = t.app.get(MembershipService);
    await membership.join(room.code, p1.id);
    await membership.generateCard(room.code, host.id);
    await membership.generateCard(room.code, p1.id);
    return { host, p1, room };
  }

  it('start schedules the first draw with the room interval', async () => {
    const { host, room } = await startedGame();
    await t.app.get(GameRunner).start(room.code, host.id);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBe(5000);
  });

  it('tick persists a number and schedules the next one', async () => {
    const { host, room } = await startedGame();
    const runner = t.app.get(GameRunner);
    await runner.start(room.code, host.id);
    const [{ id: gameId }] = await t.app.get(GamesService).findInProgress();

    await runner.tick(gameId, room.code, 5000);

    expect(await t.prisma.draw.count({ where: { gameId } })).toBe(1);
    expect(scheduled).toHaveLength(2);
  });

  it('resumes in-progress games on bootstrap without repeating numbers', async () => {
    const { host, room } = await startedGame();
    const games = t.app.get(GamesService);
    const { gameId } = await games.start(room.code, host.id);
    await games.drawNext(gameId);
    await games.drawNext(gameId);
    scheduled.length = 0;

    await t.app.get(GameRunner).onApplicationBootstrap();
    expect(scheduled).toHaveLength(1);
    scheduled[0].fn();
    await new Promise((r) => setTimeout(r, 300));

    const numbers = await games.drawnNumbers(gameId);
    expect(numbers).toHaveLength(3);
    expect(new Set(numbers).size).toBe(3);
  });

  it('stops scheduling when the game is over', async () => {
    const { host, room } = await startedGame();
    const runner = t.app.get(GameRunner);
    await runner.start(room.code, host.id);
    const [{ id: gameId }] = await t.app.get(GamesService).findInProgress();
    await t.prisma.game.update({
      where: { id: gameId },
      data: { status: 'FINISHED' },
    });
    scheduled.length = 0;

    await runner.tick(gameId, room.code, 5000);
    expect(scheduled).toHaveLength(0);
  });
});

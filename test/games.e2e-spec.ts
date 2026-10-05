import { FREE_INDEX } from '../src/contracts';
import { GamesService } from '../src/game/games.service';
import { MembershipService } from '../src/game/membership.service';
import { createTestApp, TestApp } from './support/app';
import { makeRoom, makeUser } from './support/factories';

describe('GamesService', () => {
  let t: TestApp;
  let games: GamesService;
  let membership: MembershipService;

  beforeAll(async () => {
    t = await createTestApp();
    games = t.app.get(GamesService);
    membership = t.app.get(MembershipService);
  });
  afterAll(() => t.app.close());
  beforeEach(() => t.resetDb());

  async function lobby({ guestSecond = false } = {}) {
    const host = await makeUser(t, 'Host');
    const p1 = await makeUser(t, 'Ana', { isAnonymous: guestSecond });
    const room = await makeRoom(t, host.id);
    await membership.join(room.code, p1.id);
    return { host, p1, room };
  }

  async function drawAll(gameId: string) {
    for (let i = 0; i < 75; i++) await games.drawNext(gameId);
  }

  it('needs the host and two players with cards', async () => {
    const { host, p1, room } = await lobby();
    await expect(games.start(room.code, p1.id)).rejects.toMatchObject({
      code: 'NOT_HOST',
    });
    await membership.generateCard(room.code, host.id);
    await expect(games.start(room.code, host.id)).rejects.toMatchObject({
      code: 'NOT_ENOUGH_PLAYERS',
    });
  });

  it('starts: attaches cards, increments gamesPlayed, flips room status, cannot start twice', async () => {
    const { host, p1, room } = await lobby();
    await membership.generateCard(room.code, host.id);
    await membership.generateCard(room.code, p1.id);

    const started = await games.start(room.code, host.id);

    expect(started.drawIntervalMs).toBe(5000);
    expect(
      await t.prisma.card.count({ where: { gameId: started.gameId } }),
    ).toBe(2);
    expect(
      (await t.prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
        .status,
    ).toBe('IN_GAME');
    expect(
      (await t.prisma.profile.findUniqueOrThrow({ where: { id: p1.id } }))
        .gamesPlayed,
    ).toBe(1);
    await expect(games.start(room.code, host.id)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('draws 75 unique numbers in order, then finishes without winner', async () => {
    const { host, p1, room } = await lobby();
    await membership.generateCard(room.code, host.id);
    await membership.generateCard(room.code, p1.id);
    const { gameId } = await games.start(room.code, host.id);

    const seen: number[] = [];
    for (let i = 1; i <= 75; i++) {
      const result = await games.drawNext(gameId);
      if (result.kind !== 'drawn')
        throw new Error(`esperava drawn, veio ${result.kind}`);
      expect(result.draw.seq).toBe(i);
      seen.push(result.draw.number);
    }
    expect(new Set(seen).size).toBe(75);
    expect(await games.drawnNumbers(gameId)).toEqual(seen);
    await expect(games.drawNext(gameId)).resolves.toEqual({
      kind: 'exhausted',
    });
    expect(
      (await t.prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
        .status,
    ).toBe('WAITING');
    await expect(games.drawNext(gameId)).resolves.toEqual({ kind: 'stopped' });
  });

  it('concurrent draws never produce the same seq twice', async () => {
    const { host, p1, room } = await lobby();
    await membership.generateCard(room.code, host.id);
    await membership.generateCard(room.code, p1.id);
    const { gameId } = await games.start(room.code, host.id);

    const results = await Promise.all([
      games.drawNext(gameId),
      games.drawNext(gameId),
      games.drawNext(gameId),
    ]);

    const drawn = results.filter((r) => r.kind === 'drawn');
    expect(drawn.length).toBeGreaterThanOrEqual(1);
    expect(await t.prisma.draw.count({ where: { gameId } })).toBe(drawn.length);
  });

  it('marks only drawn numbers on the own card', async () => {
    const { host, p1, room } = await lobby();
    await membership.generateCard(room.code, host.id);
    await membership.generateCard(room.code, p1.id);
    const { gameId } = await games.start(room.code, host.id);
    const card = await t.prisma.card.findFirstOrThrow({
      where: { gameId, userId: p1.id },
    });

    const index = card.grid.findIndex((_, i) => i !== FREE_INDEX);
    await expect(games.mark(room.code, p1.id, index)).rejects.toMatchObject({
      code: 'NOT_DRAWN',
    });

    await t.prisma.draw.create({
      data: { gameId, seq: 1, number: card.grid[index] },
    });
    await t.prisma.game.update({
      where: { id: gameId },
      data: { drawnCount: 1 },
    });
    await expect(games.mark(room.code, p1.id, index)).resolves.toEqual([index]);
    await expect(games.mark(room.code, p1.id, index)).resolves.toEqual([index]);
  });

  it('rejects an incomplete bingo', async () => {
    const { host, p1, room } = await lobby();
    await membership.generateCard(room.code, host.id);
    await membership.generateCard(room.code, p1.id);
    await games.start(room.code, host.id);
    await expect(
      games.claim(room.code, { id: p1.id, isAnonymous: false }),
    ).rejects.toMatchObject({ code: 'BINGO_INVALID' });
  });

  it('awards 20 points to a registered winner and none to a guest', async () => {
    const { host, p1, room } = await lobby({ guestSecond: true });
    await membership.generateCard(room.code, host.id);
    await membership.generateCard(room.code, p1.id);
    const { gameId } = await games.start(room.code, host.id);
    await drawAll(gameId);
    // drawAll esgota e finaliza sem vencedor; reabre para testar o claim.
    await t.prisma.game.update({
      where: { id: gameId },
      data: { status: 'IN_PROGRESS', finishedAt: null },
    });
    await t.prisma.room.update({
      where: { id: room.id },
      data: { status: 'IN_GAME' },
    });

    const result = await games.claim(room.code, {
      id: p1.id,
      isAnonymous: true,
    });
    expect(result.winner).toMatchObject({
      userId: p1.id,
      nickname: 'Ana',
      pointsAwarded: 0,
    });
    expect(
      (await t.prisma.profile.findUniqueOrThrow({ where: { id: p1.id } }))
        .points,
    ).toBe(0);
    expect(
      (await t.prisma.game.findUniqueOrThrow({ where: { id: gameId } }))
        .winnerId,
    ).toBe(p1.id);
  });

  it('concurrent claims produce exactly one winner and one credit', async () => {
    const { host, p1, room } = await lobby();
    await membership.generateCard(room.code, host.id);
    await membership.generateCard(room.code, p1.id);
    const { gameId } = await games.start(room.code, host.id);
    await t.prisma.draw.createMany({
      data: Array.from({ length: 75 }, (_, i) => ({
        gameId,
        seq: i + 1,
        number: i + 1,
      })),
    });
    await t.prisma.game.update({
      where: { id: gameId },
      data: { drawnCount: 75 },
    });

    const results = await Promise.allSettled([
      games.claim(room.code, { id: host.id, isAnonymous: false }),
      games.claim(room.code, { id: p1.id, isAnonymous: false }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'BINGO_INVALID' });
    const points = await t.prisma.profile.findMany({
      where: { id: { in: [host.id, p1.id] } },
    });
    expect(points.reduce((sum, p) => sum + p.points, 0)).toBe(20);
    expect(
      (await t.prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
        .status,
    ).toBe('WAITING');
  });

  it('computes remaining stones per player from the server state', async () => {
    const { host, p1, room } = await lobby();
    await membership.generateCard(room.code, host.id);
    await membership.generateCard(room.code, p1.id);
    const { gameId } = await games.start(room.code, host.id);

    expect(await games.progress(gameId)).toEqual({
      [host.id]: 24,
      [p1.id]: 24,
    });
    const card = await t.prisma.card.findFirstOrThrow({
      where: { gameId, userId: p1.id },
    });
    await t.prisma.draw.create({
      data: { gameId, seq: 1, number: card.grid[0] },
    });
    expect((await games.progress(gameId))[p1.id]).toBe(23);
  });

  it('lists in-progress games for recovery', async () => {
    const { host, p1, room } = await lobby();
    await membership.generateCard(room.code, host.id);
    await membership.generateCard(room.code, p1.id);
    const { gameId } = await games.start(room.code, host.id);
    await expect(games.findInProgress()).resolves.toEqual([
      { id: gameId, roomCode: room.code, drawIntervalMs: 5000 },
    ]);
  });
});

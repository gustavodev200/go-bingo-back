import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CARD_COST,
  DAILY_COINS,
  LOSS_COINS,
  WELCOME_COINS,
  remainingForFullCard,
  WIN_COINS,
  type MeResponse,
} from '../src/contracts';
import { GamesService } from '../src/game/games.service';
import { MembershipService } from '../src/game/membership.service';
import { ProfilesService } from '../src/profiles/profiles.service';
import { createTestApp, TestApp } from './support/app';
import { makeRoom, makeUser } from './support/factories';

describe('Moedas (e2e)', () => {
  let t: TestApp;
  let games: GamesService;
  let membership: MembershipService;
  let profiles: ProfilesService;

  beforeAll(async () => {
    t = await createTestApp();
    games = t.app.get(GamesService);
    membership = t.app.get(MembershipService);
    profiles = t.app.get(ProfilesService);
  });
  afterAll(() => t.app.close());
  beforeEach(() => t.resetDb());

  const coinsOf = async (id: string) =>
    (await t.prisma.profile.findUniqueOrThrow({ where: { id } })).coins;
  const ledgerOf = (userId: string) =>
    t.prisma.coinTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { amount: true, reason: true },
    });

  it('primeiro acesso: boas-vindas + bônus do dia; o bônus não repete no mesmo dia', async () => {
    const id = randomUUID();
    const auth = `Bearer ${await t.auth.sign(id)}`;

    const first = await request(t.url).get('/me').set('Authorization', auth);
    expect((first.body as MeResponse).coins).toBe(WELCOME_COINS + DAILY_COINS);
    expect((first.body as MeResponse).dailyBonus).toBe(DAILY_COINS);

    const again = await request(t.url).get('/me').set('Authorization', auth);
    expect((again.body as MeResponse).dailyBonus).toBe(0);
    expect((again.body as MeResponse).coins).toBe(WELCOME_COINS + DAILY_COINS);

    expect(await ledgerOf(id)).toEqual([
      { amount: WELCOME_COINS, reason: 'WELCOME' },
      { amount: DAILY_COINS, reason: 'DAILY' },
    ]);
  });

  it('bônus diário volta no dia seguinte e chamadas simultâneas creditam uma vez só', async () => {
    const user = await makeUser(t, 'Ana', { coins: 0 });
    const day1 = new Date('2026-10-08T15:00:00Z');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => profiles.claimDaily(user.id, day1)),
    );
    expect(results.filter((r) => r > 0)).toEqual([DAILY_COINS]);
    expect(
      await profiles.claimDaily(user.id, new Date('2026-10-09T15:00:00Z')),
    ).toBe(DAILY_COINS);
    expect(await coinsOf(user.id)).toBe(2 * DAILY_COINS);
  });

  it('cartela custa moedas; sem saldo é recusada e nada muda', async () => {
    const host = await makeUser(t, 'Host', { coins: CARD_COST + 1 });
    const room = await makeRoom(t, host.id);

    await membership.generateCard(room.code, host.id);
    expect(await coinsOf(host.id)).toBe(1);

    await expect(
      membership.generateCard(room.code, host.id),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_COINS' });
    expect(await coinsOf(host.id)).toBe(1);
    expect(
      await t.prisma.roomMember.findUniqueOrThrow({
        where: { roomId_userId: { roomId: room.id, userId: host.id } },
      }),
    ).toMatchObject({ cardRegens: 0 });
  });

  it('partida cartela cheia: vencedor +200, perdedores −20 até zerar, cartela automática cobra até zerar', async () => {
    const host = await makeUser(t, 'Host', { coins: 100 });
    const rich = await makeUser(t, 'Rica', { coins: 100 });
    const poor = await makeUser(t, 'Pobre', { coins: CARD_COST + 3 });
    const broke = await makeUser(t, 'Zerado', { coins: 2 });
    const room = await makeRoom(t, host.id);
    for (const p of [rich, poor, broke]) await membership.join(room.code, p.id);
    for (const p of [host, rich, poor])
      await membership.generateCard(room.code, p.id);

    // "broke" não gerou: recebe a automática e paga o que tem (2).
    const { gameId } = await games.start(room.code, host.id);
    expect(await coinsOf(broke.id)).toBe(0);

    for (let i = 0; i < 75; i++) {
      await games.drawNext(gameId);
      if ((await games.progress(gameId))[host.id] === 0) break;
    }
    const { winner } = await games.claim(room.code, {
      id: host.id,
      isAnonymous: false,
    });

    expect(winner.coinsAwarded).toBe(WIN_COINS.FULL_CARD);
    expect(await coinsOf(host.id)).toBe(100 - CARD_COST + WIN_COINS.FULL_CARD);
    expect(await coinsOf(rich.id)).toBe(100 - CARD_COST - LOSS_COINS);
    expect(await coinsOf(poor.id)).toBe(0); // tinha 3 depois da cartela
    expect(await coinsOf(broke.id)).toBe(0);
    expect(await ledgerOf(poor.id)).toEqual([
      { amount: -CARD_COST, reason: 'CARD' },
      { amount: -3, reason: 'LOSS' },
    ]);
    expect(await ledgerOf(broke.id)).toEqual([{ amount: -2, reason: 'CARD' }]);
  });

  it('partida Quina: bate com uma linha antes da cartela cheia e ganha +100', async () => {
    const host = await makeUser(t, 'Host', { coins: 100 });
    const ana = await makeUser(t, 'Ana', { coins: 100 });
    const room = await makeRoom(t, host.id, { winPattern: 'LINE' });
    await membership.join(room.code, ana.id);
    for (const p of [host, ana]) await membership.generateCard(room.code, p.id);

    const { gameId } = await games.start(room.code, host.id);
    for (let i = 0; i < 75; i++) {
      await games.drawNext(gameId);
      if ((await games.progress(gameId))[host.id] === 0) break;
    }
    const card = await t.prisma.card.findUniqueOrThrow({
      where: { gameId_userId: { gameId, userId: host.id } },
    });
    const drawn = new Set(await games.drawnNumbers(gameId));
    // Uma linha fecha bem antes das 24 casas.
    expect(remainingForFullCard(card.grid, drawn)).toBeGreaterThan(0);

    const { winner } = await games.claim(room.code, {
      id: host.id,
      isAnonymous: false,
    });
    expect(winner.coinsAwarded).toBe(WIN_COINS.LINE);
    expect(await coinsOf(host.id)).toBe(100 - CARD_COST + WIN_COINS.LINE);
    expect(await coinsOf(ana.id)).toBe(100 - CARD_COST - LOSS_COINS);
  });

  it('o banco recusa saldo negativo mesmo fora das regras do serviço', async () => {
    const user = await makeUser(t, 'Ana', { coins: 1 });
    await expect(
      t.prisma.profile.update({
        where: { id: user.id },
        data: { coins: { decrement: 2 } },
      }),
    ).rejects.toThrow();
  });
});

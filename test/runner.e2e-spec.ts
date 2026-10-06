import { GameRunner } from '../src/game/game-runner.service';
import { DRAW_TIMER, type DrawTimer } from '../src/game/draw-timer';
import { GamesService } from '../src/game/games.service';
import { MembershipService } from '../src/game/membership.service';
import { PresenceService } from '../src/game/presence.service';
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

  describe('onApplicationBootstrap presence recovery', () => {
    it('arms a real expiry grace window for members left over a restart, so an abandoned host still gets replaced', async () => {
      const host = await makeUser(t, 'Host');
      const ana = await makeUser(t, 'Ana');
      const room = await makeRoom(t, host.id);
      const membership = t.app.get(MembershipService);
      await membership.join(room.code, ana.id);
      const presence = t.app.get(PresenceService);

      // Simula o estado logo após um restart do servidor: host e ana são
      // RoomMembers reais no banco (criados sem nenhum socket conectado),
      // mas a presença em memória — que é zerada a cada boot — não tem
      // entrada nenhuma para eles.
      expect(presence.connectedSet(room.code).size).toBe(0);

      await t.app.get(GameRunner).onApplicationBootstrap();

      // connect() só reporta reconnected:true quando já existia uma entrada
      // com um timer vivo — essa é a prova de que onApplicationBootstrap
      // realmente armou uma janela de expiração para os dois, em vez de
      // deixá-los como membros "fantasma" sem presença e sem timer.
      expect(presence.connect(room.code, host.id, 'host-tmp')).toEqual({
        firstSocket: true,
        reconnected: true,
      });
      expect(presence.connect(room.code, ana.id, 'ana-tmp')).toEqual({
        firstSocket: true,
        reconnected: true,
      });
      // Volta ao estado "sem presença, timer já consumido pela checagem
      // acima" para o restante do teste, sem deixar nenhum timer real de
      // 60s pendente depois que o teste terminar.
      presence.remove(room.code, host.id);
      presence.remove(room.code, ana.id);

      // Simula o fim da janela de 60s chamando o handler de expiração
      // registrado pelo gateway — mesmo padrão já usado no teste "expiry
      // transfers host and notifies the room" em gateway.e2e-spec.ts, para
      // não depender de esperar o tempo real.
      (
        presence as unknown as { onExpired: (c: string, u: string) => void }
      ).onExpired(room.code, host.id);
      await new Promise((r) => setTimeout(r, 200)); // deixa membership.leave() (transação no banco) terminar

      const updatedRoom = await t.prisma.room.findUniqueOrThrow({
        where: { code: room.code },
      });
      expect(updatedRoom.hostId).toBe(ana.id);
      const members = await t.prisma.roomMember.findMany({
        where: { roomId: room.id },
      });
      expect(members.map((m) => m.userId)).toEqual([ana.id]);
    });
  });
});

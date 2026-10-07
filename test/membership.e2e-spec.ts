import { MembershipService } from '../src/game/membership.service';
import { createTestApp, TestApp } from './support/app';
import { makeRoom, makeUser } from './support/factories';

describe('MembershipService', () => {
  let t: TestApp;
  let svc: MembershipService;
  beforeAll(async () => {
    t = await createTestApp();
    svc = t.app.get(MembershipService);
  });
  afterAll(() => t.app.close());
  beforeEach(() => t.resetDb());

  it('joins into the lowest free slot and is idempotent', async () => {
    const host = await makeUser(t, 'Host');
    const p1 = await makeUser(t, 'Ana');
    const room = await makeRoom(t, host.id);

    await svc.join(room.code, p1.id);
    await svc.join(room.code, p1.id);

    const members = await t.prisma.roomMember.findMany({
      where: { roomId: room.id },
      orderBy: { slot: 'asc' },
    });
    expect(members.map((m) => [m.userId, m.slot])).toEqual([
      [host.id, 0],
      [p1.id, 1],
    ]);
  });

  it('requires a nickname', async () => {
    const host = await makeUser(t, 'Host');
    const noNick = await makeUser(t, null);
    const room = await makeRoom(t, host.id);
    await expect(svc.join(room.code, noNick.id)).rejects.toMatchObject({
      code: 'NICKNAME_REQUIRED',
    });
  });

  it('rejects unknown and full rooms; in-game rooms take spectators', async () => {
    const host = await makeUser(t, 'Host');
    const p1 = await makeUser(t, 'Ana');
    await expect(svc.join('ZZZZZZ', p1.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const tiny = await makeRoom(t, host.id, { maxPlayers: 1 });
    await expect(svc.join(tiny.code, p1.id)).rejects.toMatchObject({
      code: 'ROOM_FULL',
    });

    const busy = await makeRoom(t, host.id);
    await t.prisma.room.update({
      where: { id: busy.id },
      data: { status: 'IN_GAME' },
    });
    await expect(svc.join(busy.code, p1.id)).resolves.toBeUndefined();
    expect(
      await t.prisma.roomMember.count({ where: { roomId: busy.id } }),
    ).toBe(2);
    expect(
      await t.prisma.card.count({ where: { roomId: busy.id, userId: p1.id } }),
    ).toBe(0);
  });

  it('never exceeds capacity under concurrent joins', async () => {
    const host = await makeUser(t, 'Host');
    const room = await makeRoom(t, host.id, { maxPlayers: 3 });
    const players = await Promise.all(
      Array.from({ length: 6 }, (_, i) => makeUser(t, `P${i}`)),
    );

    const results = await Promise.allSettled(
      players.map((p) => svc.join(room.code, p.id)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(
      await t.prisma.roomMember.count({ where: { roomId: room.id } }),
    ).toBe(3);
  });

  it('transfers host to the oldest member when the host leaves', async () => {
    const host = await makeUser(t, 'Host');
    const p1 = await makeUser(t, 'Ana');
    const p2 = await makeUser(t, 'Bia');
    const room = await makeRoom(t, host.id);
    await svc.join(room.code, p1.id);
    await svc.join(room.code, p2.id);

    await expect(svc.leave(room.code, host.id)).resolves.toEqual({
      removed: true,
      closed: false,
      newHostId: p1.id,
    });
    expect(
      (await t.prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
        .hostId,
    ).toBe(p1.id);
  });

  it('does not leave a dangling host when the host and the heir leave concurrently', async () => {
    const host = await makeUser(t, 'Host');
    const p1 = await makeUser(t, 'Ana');
    const p2 = await makeUser(t, 'Bia');
    const room = await makeRoom(t, host.id);
    await svc.join(room.code, p1.id);
    await svc.join(room.code, p2.id);

    // host and p1 (the heir host-transfer would pick) leave at nearly the
    // same instant — without serializing the two leave() transactions, each
    // could decide the host transfer from a snapshot that predates the
    // other's commit, leaving hostId pointing at someone who already left.
    await Promise.all([
      svc.leave(room.code, host.id),
      svc.leave(room.code, p1.id),
    ]);

    const finalRoom = await t.prisma.room.findUniqueOrThrow({
      where: { id: room.id },
    });
    expect(finalRoom.hostId).toBe(p2.id);
    expect(
      await t.prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId: room.id, userId: finalRoom.hostId } },
      }),
    ).not.toBeNull();
    expect(
      await t.prisma.roomMember.count({ where: { roomId: room.id } }),
    ).toBe(1);
  });

  it('closes the room and cancels the game when the last member leaves', async () => {
    const host = await makeUser(t, 'Host');
    const room = await makeRoom(t, host.id);
    const game = await t.prisma.game.create({ data: { roomId: room.id } });

    await expect(svc.leave(room.code, host.id)).resolves.toEqual({
      removed: true,
      closed: true,
    });
    expect(
      (await t.prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
        .status,
    ).toBe('CLOSED');
    expect(
      (await t.prisma.game.findUniqueOrThrow({ where: { id: game.id } }))
        .status,
    ).toBe('CANCELLED');
  });

  it('only the host can kick or cancel, and the host cannot kick themselves', async () => {
    const host = await makeUser(t, 'Host');
    const p1 = await makeUser(t, 'Ana');
    const room = await makeRoom(t, host.id);
    await svc.join(room.code, p1.id);

    await expect(svc.kick(room.code, p1.id, host.id)).rejects.toMatchObject({
      code: 'NOT_HOST',
    });
    await expect(svc.cancel(room.code, p1.id)).rejects.toMatchObject({
      code: 'NOT_HOST',
    });
    await expect(svc.kick(room.code, host.id, host.id)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await expect(svc.kick(room.code, host.id, p1.id)).resolves.toMatchObject({
      removed: true,
    });

    await svc.cancel(room.code, host.id);
    expect(
      (await t.prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
        .status,
    ).toBe('CLOSED');
  });

  it('generates a lobby card, allows 5 regenerations, then refuses', async () => {
    const host = await makeUser(t, 'Host');
    const room = await makeRoom(t, host.id);

    const first = await svc.generateCard(room.code, host.id);
    expect(first.grid).toHaveLength(25);
    for (let i = 0; i < 5; i++) await svc.generateCard(room.code, host.id);
    await expect(svc.generateCard(room.code, host.id)).rejects.toMatchObject({
      code: 'REGEN_LIMIT',
    });
    expect(
      await t.prisma.card.count({
        where: { roomId: room.id, userId: host.id },
      }),
    ).toBe(1);
  });

  it('refuses card generation for non-members and after the game started', async () => {
    const host = await makeUser(t, 'Host');
    const outsider = await makeUser(t, 'Fora');
    const room = await makeRoom(t, host.id);
    await expect(
      svc.generateCard(room.code, outsider.id),
    ).rejects.toMatchObject({ code: 'NOT_IN_ROOM' });

    await t.prisma.room.update({
      where: { id: room.id },
      data: { status: 'IN_GAME' },
    });
    await expect(svc.generateCard(room.code, host.id)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });
});

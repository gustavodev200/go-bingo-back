import { canPlaceCue } from '../contracts';
import type { ArenaService } from '../arena/arena.service';
import type {
  TacadaPublicRoom,
  TacadaServerEventName,
  TacadaServerEventPayloads,
} from '../contracts';
import { DomainError } from '../core/domain-error';
import type { DrawTimer } from '../game/draw-timer';
import type { TacadaPublisher } from './tacada-publisher';
import {
  TacadaRoomsService,
  type TacadaConfig,
  type TacadaPlayer,
} from './tacada-rooms.service';

interface Sent {
  to: string;
  event: TacadaServerEventName;
  payload: unknown;
}

class FakePublisher implements TacadaPublisher {
  sent: Sent[] = [];
  removed: string[] = [];
  toRoom(code: string, event: TacadaServerEventName, payload: unknown) {
    this.sent.push({ to: `room:${code}`, event, payload });
  }
  toUser(userId: string, event: TacadaServerEventName, payload: unknown) {
    this.sent.push({ to: `user:${userId}`, event, payload });
  }
  removeFromRoom(userId: string, code: string) {
    this.removed.push(`${userId}@${code}`);
  }
  publicList: () => TacadaPublicRoom[] = () => [];
  publicRoomsChanged(list: () => TacadaPublicRoom[]) {
    this.publicList = list;
  }
  last<E extends TacadaServerEventName>(
    event: E,
  ): TacadaServerEventPayloads[E] {
    const found = this.sent.filter((s) => s.event === event);
    return found[found.length - 1]?.payload as TacadaServerEventPayloads[E];
  }
  events() {
    return this.sent.map((s) => s.event);
  }
}

class FakeTimer implements DrawTimer {
  pending: { fn: () => void; ms: number; id: number }[] = [];
  private nextId = 1;
  set(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.pending.push({ fn, ms, id });
    return id;
  }
  clear(handle: unknown) {
    this.pending = this.pending.filter((p) => p.id !== handle);
  }
  fire(ms: number) {
    const due = this.pending.filter((p) => p.ms === ms);
    this.pending = this.pending.filter((p) => p.ms !== ms);
    due.forEach((p) => p.fn());
  }
  scheduled(ms: number) {
    return this.pending.filter((p) => p.ms === ms).length;
  }
}

const GRACE = 30_000;
const SHOT = 30_000;
const NOW = 1_000_000;

const [ana, bia, caio]: TacadaPlayer[] = ['Ana', 'Bia', 'Caio'].map(
  (nickname, i) => ({ userId: `u${i}`, nickname, character: null }),
);

function cyclingRandom() {
  let n = 0;
  return (min: number, max: number) => min + (n++ % (max - min));
}

function setup(config: Partial<TacadaConfig> = {}) {
  const publisher = new FakePublisher();
  const timer = new FakeTimer();
  const arena = { settleSafe: jest.fn().mockResolvedValue(null) };
  const service = new TacadaRoomsService(
    publisher,
    { reconnectGraceMs: GRACE, maxRooms: 10, now: () => NOW, ...config },
    cyclingRandom(),
    timer,
    arena as unknown as ArenaService,
  );
  const state = () => publisher.last('tacada:state');
  return { service, publisher, timer, arena, state };
}

/** Two players seated, ready, match started. */
function playing() {
  const t = setup();
  const code = t.service.create(ana, 's0').state.code;
  t.service.join(code, bia, 's1');
  t.service.setReady(ana.userId, true);
  t.service.setReady(bia.userId, true);
  t.service.start(ana.userId);
  return { ...t, code };
}

const BREAK = {
  dirX: 1,
  dirY: 0,
  power: 1,
  spinX: 0,
  spinY: 0,
  cueX: 45,
  cueY: 50,
};

describe('TacadaRoomsService', () => {
  it('creates a public table with the creator on seat 0 and lists it', () => {
    const { service, publisher } = setup();
    const snap = service.create(ana, 's0');
    expect(snap.mySeat).toBe(0);
    expect(snap.state).toMatchObject({
      phase: 'LOBBY',
      isPublic: true,
      breakerSeat: 0,
      stake: 30,
      rules: { shotSeconds: 30, aimGuide: 'long' },
    });
    expect(publisher.publicList()).toEqual([
      expect.objectContaining({
        code: snap.state.code,
        players: 1,
        hostNickname: 'Ana',
      }),
    ]);
  });

  it('keeps private tables out of the list', () => {
    const { service, publisher } = setup();
    service.create(ana, 's0', false);
    expect(publisher.publicList()).toEqual([]);
  });

  it('seats a second player, refuses a third and never doubles a seat', () => {
    const { service, state } = setup();
    const code = service.create(ana, 's0').state.code;
    expect(service.join(code, bia, 's1').mySeat).toBe(1);
    expect(() => service.join(code, caio, 's2')).toThrow('A mesa está cheia');
    expect(service.join(code, bia, 's1b').mySeat).toBe(1);
    expect(state().seats.filter(Boolean)).toHaveLength(2);
  });

  it('rejects unknown tables and a second table for the same user', () => {
    const { service } = setup();
    service.create(ana, 's0');
    expect(() => service.join('ZZZZZZ', bia, 's1')).toThrow(
      'Mesa não encontrada',
    );
    expect(() => service.create(ana, 's0')).toThrow('Você já está na mesa');
  });

  it('caps the number of rooms', () => {
    const { service } = setup({ maxRooms: 1 });
    service.create(ana, 's0');
    expect(() => service.create(bia, 's1')).toThrow('Muitas mesas');
  });

  it('only starts with two ready players and only by the host', () => {
    const { service } = setup();
    const code = service.create(ana, 's0').state.code;
    service.setReady(ana.userId, true);
    expect(() => service.start(ana.userId)).toThrow('2 jogadores');
    service.join(code, bia, 's1');
    expect(() => service.start(bia.userId)).toThrow('Só o anfitrião');
    expect(() => service.start(ana.userId)).toThrow(
      'Todos precisam estar prontos',
    );
  });

  it('starts with a racked table, the breaker holding the cue ball and a shot clock', () => {
    const { state, timer, publisher } = playing();
    const game = state().game!;
    expect(game).toMatchObject({
      turn: 0,
      breakShot: true,
      ballInHand: true,
      groups: [null, null],
      turnDeadline: NOW + SHOT,
      readyAt: NOW,
    });
    expect(game.balls.filter(Boolean)).toHaveLength(16);
    expect(timer.scheduled(SHOT)).toBe(1);
    expect(publisher.last('tacada:match_started')).toEqual(
      expect.objectContaining({ breakerSeat: 0 }),
    );
  });

  it('runs the break, announces the shot and restarts the clock after the animation', () => {
    const { service, state, timer, publisher } = playing();
    expect(() => service.shoot(bia.userId, BREAK)).toThrow('Não é a sua vez');
    expect(() => service.shoot(ana.userId, { ...BREAK, cueX: 120 })).toThrow(
      'atrás da linha',
    );
    service.shoot(ana.userId, BREAK);
    const shot = publisher.last('tacada:shot');
    expect(shot.shot).toMatchObject({ seat: 0, dirX: 1, dirY: 0, power: 1 });
    expect(shot.shot.start[0]).toEqual([45, 50]);
    const game = state().game!;
    expect(game.shots).toBe(1);
    expect(game.breakShot).toBe(false);
    expect(game.readyAt).toBeGreaterThan(NOW);
    expect(game.turnDeadline).toBe(game.readyAt + SHOT);
    expect(timer.pending).toHaveLength(1);
  });

  it('refuses a new shot while the balls are still rolling', () => {
    let now = NOW;
    const t = setup({ now: () => now });
    const code = t.service.create(ana, 's0').state.code;
    t.service.join(code, bia, 's1');
    t.service.setReady(ana.userId, true);
    t.service.setReady(bia.userId, true);
    t.service.start(ana.userId);
    t.service.shoot(ana.userId, BREAK);
    const g = t.state().game!;
    const shooter = g.turn === 0 ? ana : bia;
    const input = {
      dirX: 0,
      dirY: 1,
      power: 0.3,
      spinX: 0,
      spinY: 0,
      cueX: g.ballInHand ? 20 : undefined,
      cueY: g.ballInHand ? 20 : undefined,
    };
    expect(() => t.service.shoot(shooter.userId, input)).toThrow(
      'Espere as bolas pararem',
    );
    expect(
      t.service.aim(shooter.userId, { dirX: 1, dirY: 0, power: 0 }),
    ).toBeNull();
    now = g.readyAt;
    expect(
      t.service.aim(shooter.userId, { dirX: 1, dirY: 0, power: 0.5 }),
    ).toEqual({
      code,
      aim: { seat: g.turn, dirX: 1, dirY: 0, power: 0.5 },
    });
    expect(() => t.service.shoot(shooter.userId, input)).not.toThrow();
  });

  it('relays the aim only from whoever is shooting', () => {
    const { service, code } = playing();
    expect(service.aim(bia.userId, { dirX: 1, dirY: 0, power: 0 })).toBeNull();
    expect(
      service.aim(ana.userId, {
        dirX: 1,
        dirY: 0,
        power: 0.2,
        cueX: 40,
        cueY: 50,
      }),
    ).toEqual({
      code,
      aim: { seat: 0, dirX: 1, dirY: 0, power: 0.2, cueX: 40, cueY: 50 },
    });
    expect(service.aim(caio.userId, { dirX: 1, dirY: 0, power: 0 })).toBeNull();
  });

  it('treats a timeout as a foul: ball in hand for the other player', () => {
    const { state, timer, publisher } = playing();
    timer.fire(SHOT);
    expect(publisher.events()).toContain('tacada:turn_timed_out');
    expect(state().game).toMatchObject({
      turn: 1,
      ballInHand: true,
      fouls: [1, 0],
      lastShot: { foul: 'timeout', seat: 0 },
    });
  });

  it('loses after three fouls in a row and pays the winner', () => {
    const { state, timer, arena } = playing();
    for (let i = 0; i < 5; i++) timer.fire(SHOT);
    expect(state()).toMatchObject({
      phase: 'FINISHED',
      result: { winner: 1, reason: 'fouls' },
    });
    expect(arena.settleSafe).toHaveBeenCalledWith(
      expect.objectContaining({ game: 'TACADA' }),
    );
  });

  it('pays the winner on resignation and alternates the break on rematch', () => {
    const { service, state, arena } = playing();
    service.resign(ana.userId);
    expect(state()).toMatchObject({
      phase: 'FINISHED',
      result: { winner: 1, reason: 'resign' },
    });
    expect(arena.settleSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        game: 'TACADA',
        stake: 30,
        participants: [
          { userId: 'u0', placement: 2, abandoned: false },
          { userId: 'u1', placement: 1, abandoned: false },
        ],
      }),
    );
    service.rematch(bia.userId);
    expect(state()).toMatchObject({
      phase: 'LOBBY',
      breakerSeat: 1,
      game: null,
      result: null,
    });
    expect(state().seats.every((s) => s && !s.ready)).toBe(true);
  });

  it('gives the win to the one who stays when the other leaves mid-match', () => {
    const { service, state, arena, publisher, code } = playing();
    service.leave(bia.userId);
    expect(state()).toMatchObject({
      phase: 'FINISHED',
      result: { winner: 0, reason: 'abandoned' },
    });
    expect(publisher.removed).toContain(`u1@${code}`);
    expect(arena.settleSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        participants: [
          { userId: 'u0', placement: 1, abandoned: false },
          { userId: 'u1', placement: 2, abandoned: true },
        ],
      }),
    );
  });

  it('keeps a disconnected seat for the grace period, then frees it', () => {
    const { service, state, timer } = playing();
    service.disconnect(bia.userId, 's1');
    expect(state().seats[1]).toMatchObject({
      connected: false,
      reconnectDeadline: NOW + GRACE,
    });
    timer.fire(GRACE);
    expect(state()).toMatchObject({
      phase: 'FINISHED',
      result: { reason: 'abandoned', winner: 0 },
    });
  });

  it('restores the seat on reconnection', () => {
    const { service, state, code, publisher } = playing();
    service.disconnect(bia.userId, 's1');
    service.join(code, bia, 's1-new');
    expect(state().seats[1]).toMatchObject({
      connected: true,
      reconnectDeadline: null,
    });
    expect(publisher.events()).toContain('tacada:player_reconnected');
  });

  it('refuses newcomers while playing', () => {
    const t = playing();
    expect(() => t.service.join(t.code, caio, 's2')).toThrow(DomainError);
  });

  it('lets only the host change visibility, rules and stake', () => {
    const { service, state } = setup();
    const code = service.create(ana, 's0').state.code;
    service.join(code, bia, 's1');
    const rules = { shotSeconds: 20, aimGuide: 'short' } as const;
    expect(() => service.setRules(bia.userId, rules)).toThrow('Só o anfitrião');
    service.setRules(ana.userId, rules);
    service.setVisibility(ana.userId, false);
    service.setReady(bia.userId, true);
    service.setStake(ana.userId, 60);
    expect(state()).toMatchObject({ rules, isPublic: false, stake: 60 });
    expect(state().seats[1]!.ready).toBe(false);
    expect(() => service.setStake(ana.userId, 7)).toThrow('Aposta inválida');
    expect(service.stakeToJoin(code, caio.userId)).toBe(60);
    expect(service.stakeToJoin(code, bia.userId)).toBeNull();
    expect(service.stakeCheck(ana.userId)).toEqual({
      stake: 60,
      userIds: ['u0', 'u1'],
    });
  });

  it('uses the chosen shot time for the clock', () => {
    const t = setup();
    const code = t.service.create(ana, 's0').state.code;
    t.service.join(code, bia, 's1');
    t.service.setRules(ana.userId, { shotSeconds: 45, aimGuide: 'long' });
    t.service.setReady(ana.userId, true);
    t.service.setReady(bia.userId, true);
    t.service.start(ana.userId);
    expect(t.timer.scheduled(45_000)).toBe(1);
  });

  it('passes the host role on and deletes the room when it empties', () => {
    const { service, state, publisher } = setup();
    const code = service.create(ana, 's0').state.code;
    service.join(code, bia, 's1');
    service.leave(ana.userId);
    expect(state().hostId).toBe('u1');
    service.leave(bia.userId);
    expect(publisher.publicList()).toEqual([]);
    expect(service.roomOf(bia.userId)).toBeUndefined();
  });

  it('broadcasts emotes', () => {
    const { service, publisher } = playing();
    service.emote(bia.userId, 'fire');
    expect(publisher.last('tacada:emoted')).toEqual({ seat: 1, emote: 'fire' });
  });

  it('numbers announcements and bumps the state version', () => {
    const { service, state, publisher } = playing();
    const v = state().version;
    service.shoot(ana.userId, BREAK);
    expect(state().version).toBeGreaterThan(v);
    const seqs = publisher.sent.flatMap((s) => {
      const seq = (s.payload as { seq?: number }).seq;
      return typeof seq === 'number' ? [seq] : [];
    });
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});

describe('TacadaRoomsService — CPU', () => {
  it('plays a whole game against the CPU, settled as a CPU match', () => {
    let clock = NOW;
    const t = setup({ now: () => clock });
    t.service.create(ana, 's0');
    t.service.addBot(ana.userId);
    expect(t.state().seats[1]).toMatchObject({ bot: true, ready: true });
    t.service.setReady(ana.userId, true);
    t.service.start(ana.userId);

    let cpuShots = 0;
    for (let i = 0; i < 400 && t.state().phase === 'PLAYING'; i++) {
      clock += 60_000;
      const game = t.state().game!;
      if (game.turn === 1) {
        const bot = t.timer.pending
          .filter((p) => p.ms < SHOT && p.ms !== GRACE)
          .sort((a, b) => a.ms - b.ms)[0];
        expect(bot).toBeDefined();
        t.timer.fire(bot.ms);
        cpuShots++;
        continue;
      }
      if (game.breakShot) {
        t.service.shoot(ana.userId, BREAK);
        continue;
      }
      const balls = game.balls;
      const target = balls.findIndex((b, n) => n > 0 && n !== 8 && b);
      const aimAt = balls[target >= 0 ? target : 8]!;
      let cue = balls[0] ?? ([45, 50] as const);
      const input: Record<string, number> = {};
      if (game.ballInHand) {
        cue = [20, 8];
        for (let y = 8; y < 95; y += 6)
          if (canPlaceCue(balls, 20, y, false)) {
            cue = [20, y];
            break;
          }
        input.cueX = cue[0];
        input.cueY = cue[1];
      }
      t.service.shoot(ana.userId, {
        dirX: aimAt[0] - cue[0],
        dirY: aimAt[1] - cue[1],
        power: 0.5,
        spinX: 0,
        spinY: 0,
        pocket: 0,
        ...input,
      });
    }
    expect(t.state().phase).toBe('FINISHED');
    expect(cpuShots).toBeGreaterThan(0);
    expect(t.arena.settleSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        game: 'TACADA',
        cpuPlayers: 1,
        participants: [expect.objectContaining({ userId: ana.userId })],
      }),
    );
  });

  it('only the host handles the CPU; the table closes with the last human', () => {
    const t = setup();
    const code = t.service.create(ana, 's0').state.code;
    t.service.join(code, bia, 's1');
    expect(() => t.service.addBot(bia.userId)).toThrow();
    t.service.leave(bia.userId);
    t.service.addBot(ana.userId);
    t.service.removeBot(ana.userId, 1);
    t.service.addBot(ana.userId);
    t.service.leave(ana.userId);
    expect(t.service.roomOf(ana.userId)).toBeUndefined();
    expect(t.timer.pending).toHaveLength(0);
  });
});

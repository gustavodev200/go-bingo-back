import type { ArenaService } from '../arena/arena.service';
import {
  BJ_BET_SECONDS,
  type BjPublicRoom,
  type BjServerEventName,
  type BjServerEventPayloads,
} from '../contracts';
import { DomainError } from '../core/domain-error';
import type { DrawTimer } from '../game/draw-timer';
import type { BjPublisher } from './blackjack-publisher';
import {
  BjRoomsService,
  type BjConfig,
  type BjPlayer,
} from './blackjack-rooms.service';

interface Sent {
  to: string;
  event: BjServerEventName;
  payload: unknown;
}

class FakePublisher implements BjPublisher {
  sent: Sent[] = [];
  removed: string[] = [];
  toRoom(code: string, event: BjServerEventName, payload: unknown) {
    this.sent.push({ to: `room:${code}`, event, payload });
  }
  toUser(userId: string, event: BjServerEventName, payload: unknown) {
    this.sent.push({ to: `user:${userId}`, event, payload });
  }
  removeFromRoom(userId: string, code: string) {
    this.removed.push(`${userId}@${code}`);
  }
  publicList: () => BjPublicRoom[] = () => [];
  publicRoomsChanged(list: () => BjPublicRoom[]) {
    this.publicList = list;
  }
  last<E extends BjServerEventName>(event: E): BjServerEventPayloads[E] {
    const found = this.sent.filter((s) => s.event === event);
    return found[found.length - 1]?.payload as BjServerEventPayloads[E];
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
const BET = BJ_BET_SECONDS * 1000;
const TURN = 15_000;
const NOW = 1_000_000;

const [ana, bia, caio, duda, edu, fabi]: BjPlayer[] = [
  'Ana',
  'Bia',
  'Caio',
  'Duda',
  'Edu',
  'Fabi',
].map((nickname, i) => ({ userId: `u${i}`, nickname, character: null }));

function cyclingRandom() {
  let n = 0;
  return (min: number, max: number) => min + (n++ % (max - min));
}

function setup(config: Partial<BjConfig> = {}) {
  const publisher = new FakePublisher();
  const timer = new FakeTimer();
  const arena = { settleSafe: jest.fn().mockResolvedValue(null) };
  const service = new BjRoomsService(
    publisher,
    { reconnectGraceMs: GRACE, maxRooms: 10, now: () => NOW, ...config },
    cyclingRandom(),
    timer,
    arena as unknown as ArenaService,
  );
  const state = () => publisher.last('blackjack:state');
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

/** Plays the table on autopilot (every stage times out) until the match ends. */
function runOut(t: ReturnType<typeof setup>) {
  for (let i = 0; i < 500 && t.state().phase === 'PLAYING'; i++) {
    const next = t.timer.pending.find((p) => p.ms !== GRACE);
    if (!next) break;
    t.timer.fire(next.ms);
  }
}

describe('BjRoomsService', () => {
  it('creates a public table with the creator on seat 0 and lists it', () => {
    const { service, publisher } = setup();
    const snap = service.create(ana, 's0');
    expect(snap.mySeat).toBe(0);
    expect(snap.state).toMatchObject({
      phase: 'LOBBY',
      isPublic: true,
      stake: 30,
      rules: { rounds: 10, payout: '3:2', decks: 6, turnSeconds: 15 },
    });
    expect(snap.state.seats).toHaveLength(5);
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

  it('seats five players, refuses a sixth and never doubles a seat', () => {
    const { service, state, publisher } = setup();
    const code = service.create(ana, 's0').state.code;
    for (const [i, p] of [bia, caio, duda, edu].entries())
      expect(service.join(code, p, `s${i + 1}`).mySeat).toBe(i + 1);
    expect(() => service.join(code, fabi, 's9')).toThrow('A mesa está cheia');
    expect(service.join(code, bia, 's1b').mySeat).toBe(1);
    expect(state().seats.filter(Boolean)).toHaveLength(5);
    expect(publisher.publicList()).toEqual([]);
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

  it('starts only with everybody ready and only by the host', () => {
    const { service } = setup();
    const code = service.create(ana, 's0').state.code;
    service.join(code, bia, 's1');
    expect(() => service.start(bia.userId)).toThrow('Só o anfitrião');
    service.setReady(ana.userId, true);
    expect(() => service.start(ana.userId)).toThrow(
      'Todos precisam estar prontos',
    );
    service.disconnect(bia.userId, 's1');
    service.setReady(bia.userId, true);
    expect(() => service.start(ana.userId)).toThrow('reconectar');
  });

  it('opens the first round for bets with a betting clock', () => {
    const { state, timer, publisher } = playing();
    expect(state()).toMatchObject({
      phase: 'PLAYING',
      game: { round: 1, stage: 'BETTING', deadline: NOW + BET, turn: null },
    });
    expect(state().game!.players[0]).toMatchObject({ chips: 1000, bet: null });
    expect(timer.scheduled(BET)).toBe(1);
    expect(publisher.events()).toEqual(
      expect.arrayContaining([
        'blackjack:match_started',
        'blackjack:round_started',
      ]),
    );
  });

  it('deals once both bet and runs the next clock', () => {
    const { service, state, timer } = playing();
    service.bet(ana.userId, 100);
    expect(state().game!.stage).toBe('BETTING');
    service.bet(bia.userId, 50);
    const game = state().game!;
    expect(game.stage).not.toBe('BETTING');
    expect(game.dealer.cards).toHaveLength(2);
    expect(timer.scheduled(BET)).toBe(0);
    expect(timer.pending).toHaveLength(1);
    if (game.stage === 'PLAYING') expect(game.deadline).toBe(NOW + TURN);
    expect(() => service.bet(ana.userId, 100)).toThrow(DomainError);
  });

  it('settles the final chips with the Arena, ranked by chips', () => {
    const t = setup();
    const code = t.service.create(ana, 's0').state.code;
    t.service.join(code, bia, 's1');
    t.service.setRules(ana.userId, {
      rounds: 5,
      payout: '3:2',
      decks: 6,
      turnSeconds: 15,
    });
    t.service.setReady(ana.userId, true);
    t.service.setReady(bia.userId, true);
    t.service.start(ana.userId);
    t.service.bet(ana.userId, 500);
    runOut(t);
    const result = t.state().result!;
    expect(t.state().phase).toBe('FINISHED');
    expect(result.standings).toHaveLength(2);
    const tie = result.standings.every((s) => s.placement === 1);
    if (tie) expect(t.arena.settleSafe).not.toHaveBeenCalled();
    else {
      const [input] = t.arena.settleSafe.mock.calls[0] as [
        { game: string; stake: number; participants: { userId: string }[] },
      ];
      expect(input).toMatchObject({ game: 'BLACKJACK', stake: 30 });
      expect(input.participants.map((p) => p.userId).sort()).toEqual([
        'u0',
        'u1',
      ]);
    }
    expect(t.publisher.events()).toContain('blackjack:match_over');
  });

  it('plays solo as practice: nothing goes to the Arena', () => {
    const t = setup();
    t.service.create(ana, 's0');
    t.service.setReady(ana.userId, true);
    expect(t.service.stakeCheck(ana.userId).userIds).toEqual([]);
    t.service.start(ana.userId);
    runOut(t);
    expect(t.state().phase).toBe('FINISHED');
    expect(t.state().result!.reason).toBe('rounds');
    expect(t.arena.settleSafe).not.toHaveBeenCalled();
  });

  it('gives the win to the one who stays when the other leaves mid-match', () => {
    const { service, state, arena, publisher, code } = playing();
    service.bet(ana.userId, 100);
    service.leave(bia.userId);
    expect(state()).toMatchObject({
      phase: 'FINISHED',
      result: { reason: 'abandoned' },
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
      result: { reason: 'abandoned' },
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
    expect(publisher.events()).toContain('blackjack:player_reconnected');
  });

  it('refuses newcomers while playing', () => {
    const t = playing();
    expect(() => t.service.join(t.code, caio, 's2')).toThrow(DomainError);
  });

  it('goes back to the lobby on rematch', () => {
    const t = playing();
    t.service.leave(bia.userId);
    t.service.rematch(ana.userId);
    expect(t.state()).toMatchObject({
      phase: 'LOBBY',
      game: null,
      result: null,
    });
    expect(t.state().seats[0]!.ready).toBe(false);
  });

  it('lets only the host change visibility, rules and stake', () => {
    const { service, state } = setup();
    const code = service.create(ana, 's0').state.code;
    service.join(code, bia, 's1');
    const rules = {
      rounds: 15,
      payout: '6:5',
      decks: 2,
      turnSeconds: 30,
    } as const;
    expect(() => service.setRules(bia.userId, rules)).toThrow('Só o anfitrião');
    expect(() => service.setVisibility(bia.userId, false)).toThrow(
      'Só o anfitrião',
    );
    expect(() => service.setStake(bia.userId, 60)).toThrow('Só o anfitrião');
    service.setRules(ana.userId, rules);
    service.setVisibility(ana.userId, false);
    service.setReady(bia.userId, true);
    service.setStake(ana.userId, 60);
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

  it('passes the host role on and deletes the room when it empties', () => {
    const { service, state, publisher } = setup();
    const code = service.create(ana, 's0').state.code;
    service.join(code, bia, 's1');
    service.leave(ana.userId);
    expect(state().hostId).toBe('u1');
    service.leave(bia.userId);
    expect(publisher.publicList()).toEqual([]);
    expect(service.roomOf(bia.userId)).toBeUndefined();
    expect(() => service.sync(bia.userId)).toThrow('Você não está em uma mesa');
  });

  it('drops a solo table when its player leaves mid-match', () => {
    const t = setup();
    t.service.create(ana, 's0');
    t.service.setReady(ana.userId, true);
    t.service.start(ana.userId);
    t.service.leave(ana.userId);
    expect(t.service.roomOf(ana.userId)).toBeUndefined();
    expect(t.timer.pending).toEqual([]);
  });

  it('broadcasts emotes and syncs', () => {
    const { service, publisher } = playing();
    service.emote(bia.userId, 'fire');
    expect(publisher.last('blackjack:emoted')).toEqual({
      seat: 1,
      emote: 'fire',
    });
    expect(service.sync(bia.userId).mySeat).toBe(1);
  });

  it('numbers announcements and bumps the state version', () => {
    const { service, state, publisher } = playing();
    const v = state().version;
    service.bet(ana.userId, 100);
    expect(state().version).toBeGreaterThan(v);
    const seqs = publisher.sent.flatMap((s) => {
      const seq = (s.payload as { seq?: number }).seq;
      return typeof seq === 'number' ? [seq] : [];
    });
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('clears every timer on shutdown', () => {
    const t = playing();
    t.service.disconnect(bia.userId, 's1');
    t.service.onModuleDestroy();
    expect(t.timer.pending).toEqual([]);
  });
});

describe('BjRoomsService — CPU', () => {
  const THINK = 1_100;

  it('CPUs bet and play on their own; the tournament is settled as a CPU match', () => {
    const t = setup();
    t.service.create(ana, 's0');
    t.service.addBot(ana.userId);
    t.service.addBot(ana.userId);
    expect(t.state().seats[1]).toMatchObject({ bot: true, ready: true });
    expect(t.service.stakeCheck(ana.userId).userIds).toEqual([]);
    t.service.setReady(ana.userId, true);
    t.service.start(ana.userId);

    // The CPUs bet by themselves; only Ana is missing.
    t.timer.fire(THINK);
    const players = t.state().game!.players;
    expect(players[1]!.bet).not.toBeNull();
    expect(players[2]!.bet).not.toBeNull();
    expect(players[0]!.bet).toBeNull();

    for (let i = 0; i < 2000 && t.state().phase === 'PLAYING'; i++) {
      if (t.timer.scheduled(THINK) > 0) t.timer.fire(THINK);
      else {
        const next = t.timer.pending.find((p) => p.ms !== GRACE);
        if (!next) break;
        t.timer.fire(next.ms);
      }
    }
    expect(t.state().phase).toBe('FINISHED');
    expect(t.arena.settleSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        game: 'BLACKJACK',
        cpuPlayers: 2,
        participants: [expect.objectContaining({ userId: ana.userId })],
      }),
    );
  });

  it('closes the table when the last human leaves', () => {
    const t = setup();
    t.service.create(ana, 's0');
    t.service.addBot(ana.userId);
    t.service.removeBot(ana.userId, 1);
    t.service.addBot(ana.userId);
    t.service.leave(ana.userId);
    expect(t.service.roomOf(ana.userId)).toBeUndefined();
    expect(t.timer.pending).toHaveLength(0);
  });
});

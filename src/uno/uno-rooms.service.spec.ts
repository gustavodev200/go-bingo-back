import type { ArenaService } from '../arena/arena.service';
import type {
  UnoPrivateHand,
  UnoPublicRoom,
  UnoRoomState,
  UnoServerEventName,
  UnoServerEventPayloads,
} from '../contracts';
import { DomainError } from '../core/domain-error';
import type { DrawTimer } from '../game/draw-timer';
import type { UnoPublisher } from './uno-publisher';
import {
  UnoRoomsService,
  type UnoConfig,
  type UnoPlayer,
} from './uno-rooms.service';

interface Sent {
  to: string;
  event: UnoServerEventName;
  payload: unknown;
}

class FakePublisher implements UnoPublisher {
  sent: Sent[] = [];
  removed: string[] = [];
  toRoom(code: string, event: UnoServerEventName, payload: unknown) {
    this.sent.push({ to: `room:${code}`, event, payload });
  }
  toUser(userId: string, event: UnoServerEventName, payload: unknown) {
    this.sent.push({ to: `user:${userId}`, event, payload });
  }
  removeFromRoom(userId: string, code: string) {
    this.removed.push(`${userId}@${code}`);
  }
  publicList: () => UnoPublicRoom[] = () => [];
  publicRoomsChanged(list: () => UnoPublicRoom[]) {
    this.publicList = list;
  }
  last<E extends UnoServerEventName>(
    event: E,
    to?: string,
  ): UnoServerEventPayloads[E] {
    const found = this.sent.filter(
      (s) => s.event === event && (!to || s.to === to),
    );
    return found[found.length - 1]?.payload as UnoServerEventPayloads[E];
  }
  count(event: UnoServerEventName, to?: string) {
    return this.sent.filter((s) => s.event === event && (!to || s.to === to))
      .length;
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
  /** Runs (and removes) every pending callback scheduled for `ms`. */
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
const TURN = 20_000;
const PAUSE = 3_000;
const NOW = 1_000_000;

const players: UnoPlayer[] = [
  'Ana',
  'Bia',
  'Caio',
  'Duda',
  'Edu',
  'Fê',
  'Gil',
].map((nickname, i) => ({ userId: `u${i}`, nickname, character: null }));
const [ana, bia, caio] = players;

/** Deterministic but varied, so room codes differ. */
function cyclingRandom() {
  let n = 0;
  return (min: number, max: number) => min + (n++ % (max - min));
}

function setup(config: Partial<UnoConfig> = {}) {
  const publisher = new FakePublisher();
  const timer = new FakeTimer();
  const arena = { settleSafe: jest.fn().mockResolvedValue(null) };
  const service = new UnoRoomsService(
    publisher,
    {
      reconnectGraceMs: GRACE,
      turnMs: TURN,
      roundPauseMs: PAUSE,
      maxRooms: 10,
      now: () => NOW,
      ...config,
    },
    cyclingRandom(),
    timer,
    arena as unknown as ArenaService,
  );
  const state = () => publisher.last('uno:state');
  return { publisher, timer, service, state, arena };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

/** A started match with the given players (all ready). */
function started(count = 2) {
  const ctx = setup();
  const code = ctx.service.create(ana, 's0', true).state.code;
  for (const p of players.slice(1, count))
    ctx.service.join(code, p, `s-${p.userId}`);
  for (const p of players.slice(0, count)) ctx.service.setReady(p.userId, true);
  ctx.service.start(ana.userId);
  return { ...ctx, code };
}

describe('UnoRoomsService — lobby', () => {
  it('creates a table with the creator at seat 0 and the default rules', () => {
    const { service } = setup();
    const snap = service.create(ana, 's0', false);
    expect(snap.mySeat).toBe(0);
    expect(snap.state.phase).toBe('LOBBY');
    expect(snap.state.isPublic).toBe(false);
    expect(snap.state.seats).toHaveLength(6);
    expect(snap.state.rules).toEqual({
      target: 0,
      stacking: false,
      sevenZero: false,
    });
  });

  it('seats up to 6 players and refuses the 7th', () => {
    const { service } = setup();
    const code = service.create(ana, 's0').state.code;
    for (const p of players.slice(1, 6)) service.join(code, p, `s-${p.userId}`);
    expect(codeOf(() => service.join(code, players[6], 's6'))).toBe(
      'ROOM_FULL',
    );
  });

  it('gives the same seat back to the same user and keeps one table per user', () => {
    const { service } = setup();
    const code = service.create(ana, 's0').state.code;
    service.join(code, bia, 's1');
    expect(service.join(code, bia, 's1b').mySeat).toBe(1);
    expect(codeOf(() => service.create(bia, 's1c'))).toBe('INVALID_STATE');
    expect(codeOf(() => service.join('ZZZ999', caio, 's2'))).toBe('NOT_FOUND');
  });

  it('only lets the host change the rules, and only in the lobby', () => {
    const { service, state } = setup();
    const code = service.create(ana, 's0').state.code;
    service.join(code, bia, 's1');
    const rules = { target: 200 as const, stacking: true, sevenZero: true };
    expect(codeOf(() => service.setRules(bia.userId, rules))).toBe('NOT_HOST');
    service.setRules(ana.userId, rules);
    expect(state().rules).toEqual(rules);
    service.setReady(ana.userId, true);
    service.setReady(bia.userId, true);
    service.start(ana.userId);
    expect(codeOf(() => service.setRules(ana.userId, rules))).toBe(
      'INVALID_STATE',
    );
  });

  it('starts only with the host, 2+ players, all ready', () => {
    const { service, state } = setup();
    const code = service.create(ana, 's0').state.code;
    service.setReady(ana.userId, true);
    expect(codeOf(() => service.start(ana.userId))).toBe('NOT_ENOUGH_PLAYERS');
    service.join(code, bia, 's1');
    expect(state().lobbyStatus).toBe('WAITING_PLAYERS');
    expect(codeOf(() => service.start(bia.userId))).toBe('NOT_HOST');
    expect(codeOf(() => service.start(ana.userId))).toBe('INVALID_STATE');
    service.setReady(bia.userId, true);
    expect(state().lobbyStatus).toBe('READY_TO_START');
    service.start(ana.userId);
    expect(state().phase).toBe('PLAYING');
    expect(codeOf(() => service.join(code, caio, 's2'))).toBe(
      'GAME_IN_PROGRESS',
    );
  });

  it('lists public lobbies only, fullest first', () => {
    const { service, publisher } = setup();
    const a = service.create(ana, 's0').state.code;
    service.join(a, bia, 's1');
    service.create(caio, 's2', false);
    const d = service.create(players[3], 's3').state.code;
    expect(publisher.publicList().map((r) => [r.code, r.players])).toEqual([
      [a, 2],
      [d, 1],
    ]);
    service.setReady(ana.userId, true);
    service.setReady(bia.userId, true);
    service.start(ana.userId);
    expect(publisher.publicList().map((r) => r.code)).toEqual([d]);
  });

  it('moves the host role and deletes the table when the last player leaves', () => {
    const { service, state } = setup();
    const code = service.create(ana, 's0').state.code;
    service.join(code, bia, 's1');
    service.leave(ana.userId);
    expect(state().hostId).toBe(bia.userId);
    service.leave(bia.userId);
    expect(codeOf(() => service.join(code, caio, 's2'))).toBe('NOT_FOUND');
  });

  it('sends emotes to the whole table with the seat', () => {
    const { service, publisher } = setup();
    const code = service.create(ana, 's0').state.code;
    service.emote(ana.userId, 'fire');
    expect(publisher.last('uno:emoted', `room:${code}`)).toEqual({
      seat: 0,
      emote: 'fire',
    });
  });
});

describe('UnoRoomsService — match', () => {
  it('sends each hand only to its owner and never cards in the public state', () => {
    const { publisher, state } = started(3);
    const hand = publisher.last('uno:private_hand', 'user:u0');
    expect(hand.cards).toHaveLength(7);
    expect(
      publisher.sent.filter(
        (s) => s.event === 'uno:private_hand' && s.to.startsWith('room:'),
      ),
    ).toHaveLength(0);
    expect(state().round!.handCounts.slice(0, 3)).toEqual([7, 7, 7]);
    const json = JSON.stringify(state());
    for (const c of hand.cards) expect(json).not.toContain(c.id);
  });

  it('numbers announcements and versions states in order', () => {
    const { publisher } = started(2);
    const seqs = publisher.sent
      .map((s) => (s.payload as { seq?: number }).seq)
      .filter((s): s is number => typeof s === 'number');
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    const versions = publisher.sent
      .filter((s) => s.event === 'uno:state')
      .map((s) => (s.payload as UnoRoomState).version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });

  it('times the turn and plays it automatically when it runs out', () => {
    const { timer, state, publisher } = started(2);
    const round = state().round!;
    expect(round.turnDeadline).toBe(NOW + TURN);
    expect(timer.scheduled(TURN)).toBe(1);
    const turn = round.turn;
    timer.fire(TURN);
    expect(publisher.last('uno:turn_timed_out')).toMatchObject({ seat: turn });
    expect(state().round!.turn).not.toBe(turn);
    expect(timer.scheduled(TURN)).toBe(1);
  });

  it('runs player moves and rejects moves out of turn', () => {
    const { service, state, publisher } = started(2);
    const turn = state().round!.turn;
    const other = turn === 0 ? bia : ana;
    const current = turn === 0 ? ana : bia;
    expect(codeOf(() => service.draw(other.userId))).toBe('NOT_YOUR_TURN');
    service.draw(current.userId);
    expect(publisher.last('uno:cards_drawn')).toMatchObject({
      seat: turn,
      reason: 'choice',
    });
    const hand: UnoPrivateHand = publisher.last(
      'uno:private_hand',
      `user:${current.userId}`,
    );
    expect(hand.cards).toHaveLength(8);
    if (hand.drawnCardId) service.pass(current.userId);
    expect(state().round!.turn).not.toBe(turn);
  });

  it('keeps the seat of a disconnected player and gives it back on rejoin', () => {
    const { service, publisher, state, code } = started(2);
    service.disconnect(bia.userId, 's-u1');
    expect(publisher.last('uno:player_disconnected')).toEqual(
      expect.objectContaining({ seat: 1, reconnectDeadline: NOW + GRACE }),
    );
    expect(state().seats[1]!.connected).toBe(false);
    const snap = service.join(code, bia, 's-u1b');
    expect(snap.mySeat).toBe(1);
    expect(snap.hand!.cards.length).toBeGreaterThan(0);
    expect(publisher.count('uno:player_reconnected')).toBe(1);
  });

  it('releases a lobby seat when the reconnection window expires', () => {
    const { service, timer, state } = setup();
    const code = service.create(ana, 's0').state.code;
    service.join(code, bia, 's1');
    service.disconnect(bia.userId, 's1');
    timer.fire(GRACE);
    expect(state().seats[1]).toBeNull();
  });

  it('goes on without a player who left while others remain, passing their turn', () => {
    const { service, state, timer } = started(3);
    const turn = state().round!.turn;
    const leaver = players[turn];
    service.leave(leaver.userId);
    expect(state().phase).toBe('PLAYING');
    expect(state().seats[turn]).toBeNull();
    expect(state().round!.turn).not.toBe(turn);
    expect(state().round!.handCounts[turn]).toBe(0);
    expect(timer.scheduled(TURN)).toBe(1);
  });

  it('gives the match to the last player standing and settles it in the Arena', () => {
    const { service, state, timer, publisher, arena } = started(2);
    service.disconnect(bia.userId, 's-u1');
    timer.fire(GRACE);
    expect(state().phase).toBe('FINISHED');
    expect(state().result).toMatchObject({ winner: 0, reason: 'abandoned' });
    expect(publisher.last('uno:match_over')).toMatchObject({
      winner: 0,
      reason: 'abandoned',
    });
    expect(timer.scheduled(TURN)).toBe(0);
    expect(arena.settleSafe).toHaveBeenCalledTimes(1);
    expect(arena.settleSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        game: 'UNO',
        participants: [
          { userId: ana.userId, placement: 1, abandoned: false },
          { userId: bia.userId, placement: 2, abandoned: true },
        ],
      }),
    );
  });

  it('goes back to the lobby for a rematch', () => {
    const { service, state } = started(3);
    service.leave(caio.userId);
    service.leave(bia.userId);
    expect(state().phase).toBe('FINISHED');
    service.rematch(ana.userId);
    expect(state().phase).toBe('LOBBY');
    expect(state().round).toBeNull();
    expect(state().seats[0]!.ready).toBe(false);
  });
});

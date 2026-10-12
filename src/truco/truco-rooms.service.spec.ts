import type {
  TrucoPrivateHand,
  TrucoRoomState,
  TrucoServerEventName,
} from '../contracts';
import { DomainError } from '../core/domain-error';
import type { DrawTimer } from '../game/draw-timer';
import type { TrucoPublisher } from './truco-publisher';
import {
  TrucoRoomsService,
  type TrucoConfig,
  type TrucoPlayer,
} from './truco-rooms.service';

interface Sent {
  to: string;
  event: TrucoServerEventName;
  payload: unknown;
}

class FakePublisher implements TrucoPublisher {
  sent: Sent[] = [];
  removed: string[] = [];
  toRoom(code: string, event: TrucoServerEventName, payload: unknown) {
    this.sent.push({ to: `room:${code}`, event, payload });
  }
  toUser(userId: string, event: TrucoServerEventName, payload: unknown) {
    this.sent.push({ to: `user:${userId}`, event, payload });
  }
  removeFromRoom(userId: string, code: string) {
    this.removed.push(`${userId}@${code}`);
  }
  last<T>(event: TrucoServerEventName, to?: string): T {
    const found = this.sent.filter(
      (s) => s.event === event && (!to || s.to === to),
    );
    return found[found.length - 1]?.payload as T;
  }
  count(event: TrucoServerEventName, to?: string) {
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
}

const GRACE = 30_000;
const PAUSE = 2_000;

const players: TrucoPlayer[] = ['Ana', 'Bia', 'Caio', 'Duda', 'Edu'].map(
  (nickname, i) => ({ userId: `u${i}`, nickname, character: null }),
);
const [ana, bia, caio, duda, edu] = players;

function setup(config: Partial<TrucoConfig> = {}) {
  const publisher = new FakePublisher();
  const timer = new FakeTimer();
  let seed = 1;
  const random = (min: number, max: number) => {
    seed = (seed * 48271) % 2147483647;
    return min + (seed % (max - min));
  };
  const service = new TrucoRoomsService(
    publisher,
    {
      reconnectGraceMs: GRACE,
      handPauseMs: PAUSE,
      maxRooms: 10,
      now: () => 1_000,
      ...config,
    },
    random,
    timer,
  );
  return { service, publisher, timer };
}

function full(t: ReturnType<typeof setup>) {
  const { code } = t.service.create(ana, 's-ana').state;
  for (const p of [bia, caio, duda]) t.service.join(code, p, `s-${p.nickname}`);
  return code;
}

function started(t: ReturnType<typeof setup>) {
  const code = full(t);
  for (const p of [ana, bia, caio, duda]) t.service.setReady(p.userId, true);
  t.service.start(ana.userId);
  return code;
}

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

const state = (t: ReturnType<typeof setup>) =>
  t.publisher.last<TrucoRoomState>('truco:state');

describe('TrucoRoomsService — lobby', () => {
  it('creates a room with the creator as host in seat 0', () => {
    const t = setup();
    const snap = t.service.create(ana, 's1');
    expect(snap.mySeat).toBe(0);
    expect(snap.hand).toBeNull();
    expect(snap.state).toMatchObject({
      phase: 'LOBBY',
      lobbyStatus: 'WAITING_PLAYERS',
      hostId: ana.userId,
      scores: [0, 0],
    });
    expect(snap.state.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(t.service.roomOf(ana.userId)).toBe(snap.state.code);
  });

  it('seats four players alternating teams and blocks the fifth', () => {
    const t = setup();
    const code = full(t);
    const seats = state(t).seats;
    expect(seats.map((s) => [s!.nickname, s!.team])).toEqual([
      ['Ana', 0],
      ['Bia', 1],
      ['Caio', 0],
      ['Duda', 1],
    ]);
    expect(t.publisher.count('truco:player_joined')).toBe(3);
    expect(errorCode(() => t.service.join(code, edu, 's-edu'))).toBe(
      'ROOM_FULL',
    );
  });

  it('never gives the same user a second seat', () => {
    const t = setup();
    const { code } = t.service.create(ana, 's1').state;
    t.service.join(code, bia, 's2');
    const again = t.service.join(code, bia, 's3');
    expect(again.mySeat).toBe(1);
    expect(again.state.seats.filter(Boolean)).toHaveLength(2);
  });

  it('keeps a user at one table at a time and reports unknown rooms', () => {
    const t = setup();
    const a = t.service.create(ana, 's1').state.code;
    const b = t.service.create(bia, 's2').state.code;
    expect(errorCode(() => t.service.join(b, ana, 's1'))).toBe('INVALID_STATE');
    expect(errorCode(() => t.service.create(ana, 's1'))).toBe('INVALID_STATE');
    expect(errorCode(() => t.service.join('ZZZZZZ', caio, 's3'))).toBe(
      'NOT_FOUND',
    );
    expect(a).not.toBe(b);
  });

  it('caps the number of rooms in memory', () => {
    const t = setup({ maxRooms: 1 });
    t.service.create(ana, 's1');
    expect(errorCode(() => t.service.create(bia, 's2'))).toBe('INVALID_STATE');
  });

  it('refuses to start with fewer than four players, not ready players or a non-host', () => {
    const t = setup();
    const { code } = t.service.create(ana, 's1').state;
    t.service.join(code, bia, 's2');
    t.service.join(code, caio, 's3');
    expect(errorCode(() => t.service.start(ana.userId))).toBe(
      'NOT_ENOUGH_PLAYERS',
    );
    t.service.join(code, duda, 's4');
    expect(errorCode(() => t.service.start(bia.userId))).toBe('NOT_HOST');
    expect(errorCode(() => t.service.start(ana.userId))).toBe('INVALID_STATE');
    for (const p of [ana, bia, caio]) t.service.setReady(p.userId, true);
    expect(state(t).lobbyStatus).toBe('WAITING_PLAYERS');
    t.service.setReady(duda.userId, true);
    expect(state(t).lobbyStatus).toBe('READY_TO_START');
    t.service.start(ana.userId);
    expect(state(t).phase).toBe('PLAYING');
  });

  it('lets a player move to an empty seat (and so pick a partner)', () => {
    const t = setup();
    const { code } = t.service.create(ana, 's1').state;
    t.service.join(code, bia, 's2');
    t.service.setReady(bia.userId, true);
    t.service.takeSeat(bia.userId, 2);
    const seats = state(t).seats;
    expect(seats[1]).toBeNull();
    expect(seats[2]).toMatchObject({ nickname: 'Bia', team: 0, ready: false });
    expect(errorCode(() => t.service.takeSeat(bia.userId, 0))).toBe(
      'INVALID_STATE',
    );
  });

  it('leaving the lobby frees the seat, passes the host and deletes empty rooms', () => {
    const t = setup();
    const { code } = t.service.create(ana, 's1').state;
    t.service.join(code, bia, 's2');
    t.service.leave(ana.userId);
    expect(state(t).hostId).toBe(bia.userId);
    expect(state(t).seats[0]).toBeNull();
    expect(t.publisher.removed).toContain(`${ana.userId}@${code}`);
    t.service.leave(bia.userId);
    expect(errorCode(() => t.service.join(code, caio, 's3'))).toBe('NOT_FOUND');
    expect(errorCode(() => t.service.sync(bia.userId))).toBe('NOT_IN_ROOM');
  });
});

describe('TrucoRoomsService — match', () => {
  it('deals private hands only to their owners and never in the public state', () => {
    const t = setup();
    const code = started(t);
    expect(t.publisher.count('truco:match_started')).toBe(1);
    for (const p of [ana, bia, caio, duda])
      expect(
        t.publisher.last<TrucoPrivateHand>(
          'truco:private_hand',
          `user:${p.userId}`,
        ).cards,
      ).toHaveLength(3);
    expect(
      t.publisher.sent.some(
        (s) => s.event === 'truco:private_hand' && s.to.startsWith('room:'),
      ),
    ).toBe(false);
    const json = JSON.stringify(
      t.publisher.sent.filter((s) => s.to === `room:${code}`),
    );
    expect(json).not.toMatch(/"rank"/);
  });

  it('numbers announcements and versions states monotonically', () => {
    const t = setup();
    started(t);
    const seqs = t.publisher.sent
      .map((s) => (s.payload as { seq?: number }).seq)
      .filter((n): n is number => typeof n === 'number');
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    const versions = t.publisher.sent
      .filter((s) => s.event === 'truco:state')
      .map((s) => (s.payload as TrucoRoomState).version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });

  it('plays a whole hand, updates the score and deals the next hand after the pause', () => {
    const t = setup();
    started(t);
    const turnUser = () => [ana, bia, caio, duda][state(t).match!.turn].userId;
    const hand = (userId: string) =>
      t.publisher.last<TrucoPrivateHand>(
        'truco:private_hand',
        `user:${userId}`,
      );
    // Somebody asks truco and the other team runs: hand over, 2 tentos.
    const asker = turnUser();
    t.service.requestBet(asker);
    const responder = [ana, bia, caio, duda].find(
      (p, i) => i % 2 !== state(t).match!.turn % 2,
    )!;
    t.service.respondBet(responder.userId, 'run');
    const s = state(t);
    expect(s.match!.phase).toBe('HAND_OVER');
    expect(s.scores[s.match!.turn % 2]).toBe(2);
    expect(t.publisher.count('truco:score_updated')).toBe(1);
    expect(
      errorCode(() => t.service.playCard(asker, hand(asker).cards[0].id)),
    ).toBe('INVALID_STATE');
    t.timer.fire(PAUSE);
    expect(state(t).match).toMatchObject({
      handNumber: 2,
      phase: 'AWAITING_PLAY',
    });
    // Play a card for the player whose turn it is.
    const next = turnUser();
    t.service.playCard(next, hand(next).cards[0].id);
    expect(state(t).match!.cardsLeft.filter((n) => n === 2)).toHaveLength(1);
  });

  it('rejects actions outside the match and from players at another table', () => {
    const t = setup();
    full(t);
    expect(errorCode(() => t.service.requestBet(ana.userId))).toBe(
      'INVALID_STATE',
    );
    expect(errorCode(() => t.service.playCard(edu.userId, 'x'))).toBe(
      'NOT_IN_ROOM',
    );
    expect(errorCode(() => t.service.signal(ana.userId, 'wink'))).toBe(
      'INVALID_STATE',
    );
  });

  it('finishes when a team reaches 12 and lets the table play again', () => {
    const t = setup();
    started(t);
    // Raise to 12 and run: the requesting team gets 10, then one more truco run closes it.
    let guard = 0;
    while (state(t).phase === 'PLAYING' && guard++ < 200) {
      const m = state(t).match!;
      if (m.phase === 'HAND_OVER') {
        t.timer.fire(PAUSE);
        continue;
      }
      const all = [ana, bia, caio, duda];
      if (m.phase === 'AWAITING_TEN_DECISION') {
        t.service.decideTen(
          all.find((_, i) => i % 2 === m.tenTeam)!.userId,
          false,
        );
        continue;
      }
      if (m.kind === 'normal') {
        t.service.requestBet(all[m.turn].userId);
        t.service.respondBet(all[(m.turn + 1) % 4].userId, 'run');
      } else {
        const hand = t.publisher.last<TrucoPrivateHand>(
          'truco:private_hand',
          `user:${all[m.turn].userId}`,
        );
        t.service.playCard(all[m.turn].userId, hand.cards[0].id);
      }
    }
    const s = state(t);
    expect(s.phase).toBe('FINISHED');
    expect(s.result).toMatchObject({ reason: 'points' });
    expect(Math.max(...s.scores)).toBe(12);
    expect(t.publisher.count('truco:match_over')).toBe(1);

    t.service.rematch(bia.userId);
    expect(state(t)).toMatchObject({
      phase: 'LOBBY',
      scores: [0, 0],
      match: null,
      result: null,
    });
    expect(state(t).seats.every((p) => p && !p.ready)).toBe(true);
  });
});

describe('TrucoRoomsService — signals', () => {
  it('sends the gesture only to the partner; opponents only see that a gesture happened', () => {
    const t = setup();
    started(t);
    t.publisher.sent = [];
    t.service.signal(ana.userId, 'wink');
    expect(t.publisher.sent).toEqual([
      {
        to: `user:${caio.userId}`,
        event: 'truco:signal_received',
        payload: { fromSeat: 0, gesture: 'wink' },
      },
      {
        to: `user:${bia.userId}`,
        event: 'truco:gestured',
        payload: { seat: 0 },
      },
      {
        to: `user:${duda.userId}`,
        event: 'truco:gestured',
        payload: { seat: 0 },
      },
    ]);
  });
});

describe('TrucoRoomsService — presence', () => {
  it('reserves the seat during the grace period and restores it on reconnection', () => {
    const t = setup();
    const code = started(t);
    t.service.disconnect(bia.userId, 's-Bia');
    expect(state(t).seats[1]).toMatchObject({
      connected: false,
      reconnectDeadline: 1_000 + GRACE,
    });
    expect(t.publisher.last('truco:player_disconnected')).toMatchObject({
      seat: 1,
      reconnectDeadline: 1_000 + GRACE,
    });
    // Nobody else can take the reserved seat (the room is playing anyway).
    expect(errorCode(() => t.service.join(code, edu, 's-edu'))).toBe(
      'GAME_IN_PROGRESS',
    );
    const before = t.publisher.last<TrucoPrivateHand>(
      'truco:private_hand',
      `user:${bia.userId}`,
    );
    const snap = t.service.join(code, bia, 's-bia-2');
    expect(snap.mySeat).toBe(1);
    expect(snap.hand).toEqual(before);
    expect(state(t).seats[1]).toMatchObject({ connected: true });
    expect(t.publisher.count('truco:player_reconnected')).toBe(1);
    expect(t.timer.pending.filter((p) => p.ms === GRACE)).toHaveLength(0);
  });

  it('only starts the grace period when the last socket of the user closes', () => {
    const t = setup();
    const code = full(t);
    t.service.join(code, bia, 's-bia-tab2');
    t.service.disconnect(bia.userId, 's-Bia');
    expect(state(t).seats[1]!.connected).toBe(true);
    t.service.disconnect(bia.userId, 'unknown-socket');
    t.service.disconnect(edu.userId, 'nope');
    t.service.disconnect(bia.userId, 's-bia-tab2');
    expect(state(t).seats[1]!.connected).toBe(false);
  });

  it('expiry in the lobby frees the seat', () => {
    const t = setup();
    const code = full(t);
    t.service.disconnect(duda.userId, 's-Duda');
    t.timer.fire(GRACE);
    expect(state(t).seats[3]).toBeNull();
    expect(t.publisher.last('truco:player_left')).toMatchObject({
      seat: 3,
      reason: 'expired',
    });
    expect(t.service.join(code, edu, 's-edu').mySeat).toBe(3);
  });

  it('expiry during the match is a walkover for the other team', () => {
    const t = setup();
    started(t);
    t.service.disconnect(caio.userId, 's-Caio');
    t.timer.fire(GRACE);
    const s = state(t);
    expect(s.phase).toBe('FINISHED');
    expect(s.result).toMatchObject({ winnerTeam: 1, reason: 'abandoned' });
    expect(s.seats[2]).toBeNull();
    expect(t.timer.pending.filter((p) => p.ms === PAUSE)).toHaveLength(0);
  });

  it('leaving mid-match is an immediate walkover', () => {
    const t = setup();
    started(t);
    t.service.leave(bia.userId);
    expect(state(t).result).toMatchObject({
      winnerTeam: 0,
      reason: 'abandoned',
    });
  });

  it('moves the host role to a connected player when the host drops', () => {
    const t = setup();
    full(t);
    t.service.disconnect(ana.userId, 's-ana');
    expect(state(t).hostId).toBe(bia.userId);
    for (const p of [ana, bia, caio, duda]) t.service.setReady(p.userId, true);
    // Cannot start while someone is reconnecting.
    expect(errorCode(() => t.service.start(bia.userId))).toBe('INVALID_STATE');
  });

  it('a late expiry for someone who already left does nothing', () => {
    const t = setup();
    const code = full(t);
    t.service.disconnect(duda.userId, 's-Duda');
    const timer = t.timer.pending[0];
    t.service.leave(duda.userId);
    timer.fn();
    expect(t.service.join(code, edu, 's-edu').mySeat).toBe(3);
  });

  it('clears everything on shutdown', () => {
    const t = setup();
    started(t);
    t.service.disconnect(ana.userId, 's-ana');
    t.service.onModuleDestroy();
    expect(t.timer.pending).toHaveLength(0);
    expect(t.service.roomOf(bia.userId)).toBeUndefined();
  });
});

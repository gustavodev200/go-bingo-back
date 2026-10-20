import type { ArenaService } from '../arena/arena.service';
import type {
  DamasPublicRoom,
  DamasRoomState,
  DamasServerEventName,
  DamasServerEventPayloads,
} from '../contracts';
import { DomainError } from '../core/domain-error';
import type { DrawTimer } from '../game/draw-timer';
import type { DamasPublisher } from './damas-publisher';
import {
  DamasRoomsService,
  type DamasConfig,
  type DamasPlayer,
} from './damas-rooms.service';

interface Sent {
  to: string;
  event: DamasServerEventName;
  payload: unknown;
}

class FakePublisher implements DamasPublisher {
  sent: Sent[] = [];
  removed: string[] = [];
  toRoom(code: string, event: DamasServerEventName, payload: unknown) {
    this.sent.push({ to: `room:${code}`, event, payload });
  }
  toUser(userId: string, event: DamasServerEventName, payload: unknown) {
    this.sent.push({ to: `user:${userId}`, event, payload });
  }
  removeFromRoom(userId: string, code: string) {
    this.removed.push(`${userId}@${code}`);
  }
  publicList: () => DamasPublicRoom[] = () => [];
  publicRoomsChanged(list: () => DamasPublicRoom[]) {
    this.publicList = list;
  }
  last<E extends DamasServerEventName>(event: E): DamasServerEventPayloads[E] {
    const found = this.sent.filter((s) => s.event === event);
    return found[found.length - 1]?.payload as DamasServerEventPayloads[E];
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
const TURN = 60_000;
const NOW = 1_000_000;

const [ana, bia, caio]: DamasPlayer[] = ['Ana', 'Bia', 'Caio'].map(
  (nickname, i) => ({ userId: `u${i}`, nickname, character: null }),
);

function cyclingRandom() {
  let n = 0;
  return (min: number, max: number) => min + (n++ % (max - min));
}

function setup(config: Partial<DamasConfig> = {}) {
  const publisher = new FakePublisher();
  const timer = new FakeTimer();
  const arena = { settleSafe: jest.fn().mockResolvedValue(null) };
  const service = new DamasRoomsService(
    publisher,
    { reconnectGraceMs: GRACE, maxRooms: 10, now: () => NOW, ...config },
    cyclingRandom(),
    timer,
    arena as unknown as ArenaService,
  );
  const state = () => publisher.last('damas:state');
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

function firstMove(state: DamasRoomState) {
  return state.game!.moves[0];
}

describe('DamasRoomsService', () => {
  it('creates a public table with the creator on seat 0 and lists it', () => {
    const { service, publisher } = setup();
    const snap = service.create(ana, 's0');
    expect(snap.mySeat).toBe(0);
    expect(snap.state).toMatchObject({
      phase: 'LOBBY',
      isPublic: true,
      whiteSeat: 0,
      stake: 30,
      rules: { turnSeconds: 60 },
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

  it('starts the match with white to move and a turn clock', () => {
    const { state, timer, publisher } = playing();
    expect(state()).toMatchObject({
      phase: 'PLAYING',
      game: { turn: 'white', turnDeadline: NOW + TURN },
    });
    expect(state().game!.moves).toHaveLength(7);
    expect(timer.scheduled(TURN)).toBe(1);
    expect(publisher.last('damas:match_started')).toMatchObject({
      whiteSeat: 0,
    });
  });

  it('plays moves, alternates turns and restarts the clock', () => {
    const { service, state, timer } = playing();
    const m = firstMove(state());
    service.move(ana.userId, m.from, m.path);
    expect(state().game).toMatchObject({ turn: 'black', plies: 1 });
    expect(timer.scheduled(TURN)).toBe(1);
    expect(() => service.move(ana.userId, m.from, m.path)).toThrow(
      'Não é a sua vez',
    );
  });

  it('auto-plays on timeout', () => {
    const { state, timer, publisher } = playing();
    timer.fire(TURN);
    expect(publisher.events()).toContain('damas:turn_timed_out');
    expect(state().game).toMatchObject({ turn: 'black', timeouts: [1, 0] });
  });

  it('pays the winner on resignation and swaps colours on rematch', () => {
    const { service, state, arena } = playing();
    service.resign(ana.userId);
    expect(state()).toMatchObject({
      phase: 'FINISHED',
      result: { winner: 1, reason: 'resign' },
    });
    expect(arena.settleSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        game: 'DAMAS',
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
      whiteSeat: 1,
      game: null,
      result: null,
    });
    expect(state().seats.every((s) => s && !s.ready)).toBe(true);
  });

  it('does not settle an agreed draw', () => {
    const { service, state, arena } = playing();
    service.offerDraw(ana.userId);
    expect(state().game!.drawOffer).toBe(0);
    service.answerDraw(bia.userId, true);
    expect(state().result).toEqual({ winner: null, reason: 'draw_agreed' });
    expect(arena.settleSafe).not.toHaveBeenCalled();
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
    expect(publisher.events()).toContain('damas:player_reconnected');
  });

  it('refuses newcomers while playing', () => {
    const { service, code } = playing();
    service.leave(ana.userId);
    expect(() => service.join(code, caio, 's2')).not.toThrow();
    const t = playing();
    expect(() => t.service.join(t.code, caio, 's2')).toThrow(DomainError);
  });

  it('lets only the host change visibility, rules and stake', () => {
    const { service, state } = setup();
    const code = service.create(ana, 's0').state.code;
    service.join(code, bia, 's1');
    expect(() => service.setRules(bia.userId, { turnSeconds: 30 })).toThrow(
      'Só o anfitrião',
    );
    service.setRules(ana.userId, { turnSeconds: 30 });
    service.setVisibility(ana.userId, false);
    service.setReady(bia.userId, true);
    service.setStake(ana.userId, 60);
    expect(state()).toMatchObject({
      rules: { turnSeconds: 30 },
      isPublic: false,
      stake: 60,
    });
    expect(state().seats[1]!.ready).toBe(false);
    expect(() => service.setStake(ana.userId, 7)).toThrow('Aposta inválida');
    expect(service.stakeToJoin(code, caio.userId)).toBe(60);
    expect(service.stakeToJoin(code, bia.userId)).toBeNull();
    expect(service.stakeCheck(ana.userId)).toEqual({
      stake: 60,
      userIds: ['u0', 'u1'],
    });
  });

  it('uses the chosen turn time for the clock', () => {
    const t = setup();
    const code = t.service.create(ana, 's0').state.code;
    t.service.join(code, bia, 's1');
    t.service.setRules(ana.userId, { turnSeconds: 30 });
    t.service.setReady(ana.userId, true);
    t.service.setReady(bia.userId, true);
    t.service.start(ana.userId);
    expect(t.timer.scheduled(30_000)).toBe(1);
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
    expect(publisher.last('damas:emoted')).toEqual({ seat: 1, emote: 'fire' });
  });

  it('numbers announcements and bumps the state version', () => {
    const { service, state, publisher } = playing();
    const v = state().version;
    const m = firstMove(state());
    service.move(ana.userId, m.from, m.path);
    expect(state().version).toBeGreaterThan(v);
    const seqs = publisher.sent.flatMap((s) => {
      const seq = (s.payload as { seq?: number }).seq;
      return typeof seq === 'number' ? [seq] : [];
    });
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});

describe('DamasRoomsService — CPU', () => {
  const THINK = 1_100;

  it('plays a whole game against the CPU, settled as a CPU match', () => {
    const { service, state, timer, arena } = setup();
    service.create(ana, 's0', true);
    service.addBot(ana.userId);
    expect(state().seats[1]).toMatchObject({ bot: true, ready: true });
    service.setReady(ana.userId, true);
    service.start(ana.userId);

    for (let step = 0; step < 600 && state().phase === 'PLAYING'; step++) {
      const s = state();
      const mine = s.game!.turn === (s.whiteSeat === 0 ? 'white' : 'black');
      if (mine) {
        const m = firstMove(s);
        service.move(ana.userId, m.from, m.path);
      } else timer.fire(THINK);
    }
    expect(state().phase).toBe('FINISHED');
    if (state().result!.winner !== null)
      expect(arena.settleSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          game: 'DAMAS',
          cpuPlayers: 1,
          participants: [expect.objectContaining({ userId: ana.userId })],
        }),
      );
  });

  it('the host can take the CPU back out of the lobby', () => {
    const { service, state, timer } = setup();
    service.create(ana, 's0', true);
    service.addBot(ana.userId);
    service.removeBot(ana.userId, 1);
    expect(state().seats[1]).toBeNull();
    expect(timer.pending).toHaveLength(0);
  });
});

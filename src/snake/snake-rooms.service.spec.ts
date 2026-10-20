import type { ArenaService } from '../arena/arena.service';
import {
  SNAKE_MAX_PLAYERS,
  SNAKE_TICK_MS,
  SNAKE_CPU_FILL,
  SNAKE_TICK_RATE,
  decodeSnakeFrame,
  type SnakePublicRoom,
  type SnakeRoomState,
  type SnakeServerEventName,
} from '../contracts';
import { DomainError } from '../core/domain-error';
import type { DrawTimer } from '../game/draw-timer';
import type { SnakePublisher } from './snake-publisher';
import { SnakeRoomsService, type SnakeConfig } from './snake-rooms.service';

interface Sent {
  to: string;
  event: SnakeServerEventName;
  payload: unknown;
}

class FakePublisher implements SnakePublisher {
  sent: Sent[] = [];
  frames: { socketId: string; frame: ArrayBuffer }[] = [];
  removed: string[] = [];
  publicList: () => SnakePublicRoom[] = () => [];
  toRoom(code: string, event: SnakeServerEventName, payload: unknown) {
    this.sent.push({ to: `room:${code}`, event, payload });
  }
  toSocket(socketId: string, event: SnakeServerEventName, payload: unknown) {
    this.sent.push({ to: socketId, event, payload });
  }
  frame(socketId: string, frame: ArrayBuffer) {
    this.frames.push({ socketId, frame });
  }
  removeFromRoom(socketId: string, code: string) {
    this.removed.push(`${socketId}@${code}`);
  }
  publicRoomsChanged(list: () => SnakePublicRoom[]) {
    this.publicList = list;
  }
  of(event: SnakeServerEventName, to?: string) {
    return this.sent.filter((s) => s.event === event && (!to || s.to === to));
  }
  lastState(): SnakeRoomState {
    return this.of('snake:state').at(-1)!.payload as SnakeRoomState;
  }
}

const GRACE_MS = 5_000;

/** Manual clock: scheduled callbacks run only when the test says so. */
class FakeTimer implements DrawTimer {
  private seq = 0;
  pending = new Map<number, { fn: () => void; ms: number }>();
  set(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.pending.set(id, { fn, ms });
    return id;
  }
  clear(handle: unknown) {
    this.pending.delete(handle as number);
  }
  /** Runs `times` arena ticks (only the tick-sized timers). */
  tick(times = 1) {
    for (let i = 0; i < times; i++) {
      const due = [...this.pending].filter(([, t]) => t.ms !== GRACE_MS);
      due.forEach(([id]) => this.pending.delete(id));
      due.forEach(([, t]) => t.fn());
    }
  }
  /** Fires the long timers (reconnection windows). */
  expire() {
    const due = [...this.pending].filter(([, t]) => t.ms === GRACE_MS);
    due.forEach(([id]) => this.pending.delete(id));
    due.forEach(([, t]) => t.fn());
  }
}

const player = (n: string) => ({
  userId: `u-${n}`,
  nickname: n,
  character: 'c01',
});
const ANA = player('Ana');
const BIA = player('Bia');
let codeSeq = 0;
// Deterministic codes: each call walks the alphabet a bit.
const random = (min: number, max: number) => (codeSeq++ % (max - min)) + min;

function setup(config: Partial<SnakeConfig> = {}) {
  const publisher = new FakePublisher();
  const timer = new FakeTimer();
  const arena = { settleSafe: jest.fn().mockResolvedValue(null) };
  const service = new SnakeRoomsService(
    { reconnectGraceMs: GRACE_MS, maxRooms: 5, cpuFill: 0, ...config },
    publisher,
    random,
    timer,
    arena as unknown as ArenaService,
  );
  return { publisher, timer, service, arena };
}

describe('SnakeRoomsService', () => {
  it('creates a room with a code and streams the arena to the creator', () => {
    const { service, publisher, timer } = setup();
    const snap = service.create(ANA, 's1', false);
    expect(snap.state).toMatchObject({
      isPublic: false,
      hostId: ANA.userId,
      players: [{ nickname: 'Ana', connected: true, playing: false }],
    });
    expect(snap.state.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(service.roomOf(ANA.userId)).toBe(snap.state.code);
    timer.tick();
    expect(publisher.frames.map((f) => f.socketId)).toEqual(['s1']);
    expect(decodeSnakeFrame(publisher.frames[0].frame).myId).toBe(0);
  });

  it('lists only public rooms with a free place and lets the host change visibility', () => {
    const { service, publisher } = setup();
    const a = service.create(ANA, 's1', true).state.code;
    service.create(BIA, 's2', false);
    expect(publisher.publicList()).toEqual([
      { code: a, hostNickname: 'Ana', hostCharacter: 'c01', players: 1 },
    ]);
    expect(() => service.setVisibility(BIA.userId, true)).not.toThrow();
    expect(publisher.publicList()).toHaveLength(2);
    service.join(a, player('Caio'), 's3');
    expect(() => service.setVisibility('u-Caio', false)).toThrow(DomainError);
    service.setVisibility(ANA.userId, false);
    expect(service.listPublic()).toHaveLength(1);
  });

  it('joins by code, refuses unknown codes, full rooms and a second room', () => {
    const { service } = setup();
    const code = service.create(ANA, 's1').state.code;
    expect(() => service.join('ZZZZZZ', BIA, 's2')).toThrow(
      'Sala não encontrada',
    );
    expect(service.join(code, BIA, 's2').state.players).toHaveLength(2);
    for (let i = 2; i < SNAKE_MAX_PLAYERS; i++)
      service.join(code, player(`P${i}`), `s-${i}`);
    expect(() => service.join(code, player('Extra'), 'sx')).toThrow(
      'A sala está cheia',
    );
    expect(() => service.create(BIA, 's2')).toThrow(DomainError);
    expect(service.listPublic()).toHaveLength(0);
  });

  it('refuses new rooms past the limit', () => {
    const { service } = setup({ maxRooms: 1 });
    service.create(ANA, 's1');
    expect(() => service.create(BIA, 's2')).toThrow(DomainError);
  });

  it('plays, steers, ranks and tells the player how it died', () => {
    const { service, publisher, timer } = setup();
    const code = service.create(ANA, 's1').state.code;
    service.join(code, BIA, 's2');
    const { id } = service.play(ANA.userId, 4);
    expect(service.play(ANA.userId, 4).id).toBe(id);
    expect(publisher.lastState().players[0].playing).toBe(true);
    timer.tick(SNAKE_TICK_RATE);
    expect(publisher.of('snake:meta')[0].payload).toEqual({
      meta: [[id, 'Ana', 4]],
    });
    expect(publisher.of('snake:leaderboard', 's1')[0].payload).toMatchObject({
      rank: 1,
      total: 1,
    });
    expect(publisher.of('snake:leaderboard', 's2')[0].payload).toMatchObject({
      rank: 0,
    });
    expect(
      decodeSnakeFrame(
        publisher.frames.filter((f) => f.socketId === 's1').at(-1)!.frame,
      ).myId,
    ).toBe(id);
    service.view(ANA.userId, 1, 99_999);
    for (let i = 0; i < 2000 && !publisher.of('snake:dead').length; i++) {
      service.input(ANA.userId, { a: 0, b: false });
      timer.tick();
    }
    expect(publisher.of('snake:dead', 's1')[0].payload).toMatchObject({
      killer: null,
      kills: 0,
    });
    expect(publisher.of('snake:feed', `room:${code}`)[0].payload).toMatchObject(
      { victim: 'Ana' },
    );
    expect(publisher.lastState().players[0].playing).toBe(false);
    expect(service.play(ANA.userId, 1).id).toBeGreaterThan(0);
  });

  it('settles a kill between two players as a duel in the Arena, but not suicides', () => {
    const { service, timer, arena } = setup();
    const code = service.create(ANA, 's1').state.code;
    service.join(code, BIA, 's2');
    const killerId = service.play(ANA.userId, 1).id;
    const victimId = service.play(BIA.userId, 2).id;
    timer.tick();
    const room = (
      service as unknown as {
        rooms: Map<
          string,
          {
            arena: {
              snakes: Map<number, never>;
              onEvent: (ev: unknown) => void;
            };
          }
        >;
      }
    ).rooms.get(code)!;
    const killer = room.arena.snakes.get(killerId);
    const victim = room.arena.snakes.get(victimId);

    room.arena.onEvent({ t: 'death', snake: victim, killer });

    expect(arena.settleSafe).toHaveBeenCalledTimes(1);
    expect(arena.settleSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        game: 'SNAKE',
        participants: [
          { userId: ANA.userId, placement: 1 },
          { userId: BIA.userId, placement: 2 },
        ],
      }),
    );

    // Bateu na borda / no próprio corpo: sem duelo.
    service.play(BIA.userId, 2);
    arena.settleSafe.mockClear();
    const again = room.arena.snakes.get(killerId);
    room.arena.onEvent({ t: 'death', snake: again, killer: null });
    expect(arena.settleSafe).not.toHaveBeenCalled();
  });

  it('a live snake keeps going alone; one player alone can play too', () => {
    const { service } = setup();
    const code = service.create(ANA, 's1').state.code;
    service.join(code, BIA, 's2');
    service.play(ANA.userId, 0);
    service.disconnect(BIA.userId, 's2');
    // already alive: keeps its snake
    expect(service.play(ANA.userId, 0).id).toBeGreaterThan(0);
    // Bia comes back to a room where only she is online: CPU snakes keep her company
    service.leave(ANA.userId);
    service.join(code, BIA, 's2b');
    expect(service.play(BIA.userId, 0).id).toBeGreaterThan(0);
  });

  it('ignores input and view from users outside rooms; play requires a room', () => {
    const { service } = setup();
    service.input('nobody', { a: 1, b: true });
    service.view('nobody', 1, 1);
    expect(() => service.play('nobody', 0)).toThrow(
      'Você não está em uma sala',
    );
  });

  it('a dropped socket kills the snake, keeps the place and hands the host over', () => {
    const { service, publisher, timer } = setup();
    const code = service.create(ANA, 's1').state.code;
    service.join(code, BIA, 's2');
    service.play(ANA.userId, 0);
    service.disconnect(ANA.userId, 'other-socket');
    service.disconnect(ANA.userId, 's1');
    expect(publisher.lastState()).toMatchObject({ hostId: BIA.userId });
    expect(publisher.lastState().players[0]).toMatchObject({
      connected: false,
      playing: false,
    });
    // reconnects in time: same place
    service.join(code, ANA, 's1b');
    timer.expire();
    expect(service.roomOf(ANA.userId)).toBe(code);
    // drops again and the window runs out
    service.disconnect(ANA.userId, 's1b');
    timer.expire();
    expect(service.roomOf(ANA.userId)).toBeUndefined();
    expect(publisher.lastState().players.map((p) => p.nickname)).toEqual([
      'Bia',
    ]);
  });

  it('the last one out closes the room and stops its loop', () => {
    const { service, publisher, timer } = setup();
    const code = service.create(ANA, 's1').state.code;
    service.join(code, BIA, 's2');
    service.leave(BIA.userId);
    expect(publisher.removed).toContain(`s2@${code}`);
    service.leave(ANA.userId);
    expect(() => service.leave(ANA.userId)).toThrow(DomainError);
    timer.tick();
    expect(publisher.frames).toHaveLength(0);
    expect(() => service.join(code, ANA, 's1')).toThrow('Sala não encontrada');
    service.disconnect(ANA.userId, 's1');
  });

  it('ticks at a fixed rate: time spent between ticks is discounted from the next wait', () => {
    let now = 1_000;
    const spy = jest.spyOn(performance, 'now').mockImplementation(() => now);
    const { service, timer } = setup();
    service.create(ANA, 's1');
    const waits = () => [...timer.pending.values()].map((t) => t.ms);
    expect(waits()).toEqual([SNAKE_TICK_MS]);
    now += SNAKE_TICK_MS + 30; // the timer fired 30 ms late
    timer.tick();
    expect(waits()[0]).toBeCloseTo(SNAKE_TICK_MS - 30);
    now += 10_000; // process stalled: restart the cadence instead of bursting
    timer.tick();
    expect(waits()[0]).toBe(0);
    spy.mockRestore();
  });

  it('stops everything on shutdown', () => {
    const { service, timer } = setup();
    service.create(ANA, 's1');
    service.disconnect(ANA.userId, 's1');
    service.onModuleDestroy();
    expect(timer.pending.size).toBe(0);
  });
});

describe('SnakeRoomsService — CPU', () => {
  it('fills the arena with CPU snakes while few people are online, and they move on their own', () => {
    const { service, publisher, timer } = setup({ cpuFill: SNAKE_CPU_FILL });
    service.create(ANA, 's1');
    service.play(ANA.userId, 0);
    timer.tick(SNAKE_TICK_RATE * (SNAKE_CPU_FILL + 1));
    const metas = publisher
      .of('snake:meta')
      .flatMap((m) => (m.payload as { meta: [number, string, number][] }).meta);
    const bots = metas.filter(([, name]) => name.startsWith('CPU '));
    // (a CPU that crashed is replaced, so there may be more spawns than places)
    expect(bots.length).toBeGreaterThanOrEqual(SNAKE_CPU_FILL - 1);
    const board = publisher.of('snake:leaderboard', 's1').at(-1)!.payload as {
      total: number;
    };
    expect(board.total).toBeGreaterThanOrEqual(SNAKE_CPU_FILL - 1);
    // CPU snakes are not people: they take no place in the room
    expect(publisher.lastState().players).toHaveLength(1);
  });

  it('nobody online: no CPU is spawned', () => {
    const { service, publisher, timer } = setup({ cpuFill: SNAKE_CPU_FILL });
    service.create(ANA, 's1');
    service.disconnect(ANA.userId, 's1');
    timer.tick(SNAKE_TICK_RATE * 3);
    const metas = publisher
      .of('snake:meta')
      .flatMap((m) => (m.payload as { meta: [number, string, number][] }).meta);
    expect(metas.filter(([, name]) => name.startsWith('CPU '))).toHaveLength(0);
  });
});

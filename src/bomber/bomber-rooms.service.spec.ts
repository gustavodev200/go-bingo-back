import type { ArenaService } from '../arena/arena.service';
import {
  BOMBER_TICK_MS,
  type BomberFrame,
  type BomberPublicRoom,
  type BomberRoomState,
  type BomberServerEventName,
  type BomberServerEventPayloads,
} from '../contracts';
import { DomainError } from '../core/domain-error';
import type { DrawTimer } from '../game/draw-timer';
import type { BomberPublisher } from './bomber-publisher';
import type { BomberRound } from './engine/round';
import {
  BomberRoomsService,
  type BomberConfig,
  type BomberPlayer,
} from './bomber-rooms.service';

interface Sent {
  to: string;
  event: BomberServerEventName;
  payload: unknown;
}

class FakePublisher implements BomberPublisher {
  sent: Sent[] = [];
  frames: BomberFrame[] = [];
  removed: string[] = [];
  publicList: () => BomberPublicRoom[] = () => [];
  toRoom(code: string, event: BomberServerEventName, payload: unknown) {
    this.sent.push({ to: `room:${code}`, event, payload });
  }
  frame(_code: string, frame: BomberFrame) {
    this.frames.push(frame);
  }
  removeFromRoom(userId: string, code: string) {
    this.removed.push(`${userId}@${code}`);
  }
  publicRoomsChanged(list: () => BomberPublicRoom[]) {
    this.publicList = list;
  }
  last<E extends BomberServerEventName>(
    event: E,
  ): BomberServerEventPayloads[E] {
    const found = this.sent.filter((s) => s.event === event);
    return found[found.length - 1]?.payload as BomberServerEventPayloads[E];
  }
  count(event: BomberServerEventName) {
    return this.sent.filter((s) => s.event === event).length;
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
const PAUSE = 3_000;
const NOW = 1_000_000;

const player = (id: string): BomberPlayer => ({
  userId: id,
  nickname: id.toUpperCase(),
  character: 'c01',
});

describe('BomberRoomsService', () => {
  let publisher: FakePublisher;
  let timer: FakeTimer;
  let service: BomberRoomsService;
  let arena: { settleSafe: jest.Mock };
  let seq = 0;

  beforeEach(() => {
    publisher = new FakePublisher();
    timer = new FakeTimer();
    seq = 0;
    const config: BomberConfig = {
      reconnectGraceMs: GRACE,
      roundPauseMs: PAUSE,
      maxRooms: 3,
      now: () => NOW,
    };
    // Deterministic "random": cycles through small numbers.
    const random = (min: number, max: number) =>
      min + (seq++ % Math.max(1, max - min));
    arena = { settleSafe: jest.fn().mockResolvedValue(null) };
    service = new BomberRoomsService(
      publisher,
      config,
      random,
      timer,
      arena as unknown as ArenaService,
    );
  });

  afterEach(() => service.onModuleDestroy());

  const state = (): BomberRoomState => publisher.last('bomber:state');

  /** Room with `n` humans (a, b, ...) all ready. */
  function roomWith(n: number, ready = true): string {
    const ids = 'abcdefgh'.slice(0, n).split('');
    const code = service.create(player(ids[0]), `s-${ids[0]}`).state.code;
    for (const id of ids.slice(1)) service.join(code, player(id), `s-${id}`);
    if (ready) for (const id of ids) service.setReady(id, true);
    return code;
  }

  /** Runs ticks until the current round is over. */
  function playRound(max = 10_000) {
    for (let i = 0; i < max && timer.scheduled(BOMBER_TICK_MS); i++)
      timer.fire(BOMBER_TICK_MS);
  }

  it('creates a public room with the creator at seat 0 and lists it', () => {
    const snap = service.create(player('a'), 's1');
    expect(snap.mySeat).toBe(0);
    expect(snap.state.phase).toBe('LOBBY');
    expect(snap.state.seats[0]).toMatchObject({
      nickname: 'A',
      color: 0,
      bot: false,
    });
    expect(snap.frame).toBeNull();
    expect(publisher.publicList()).toEqual([
      expect.objectContaining({
        code: snap.state.code,
        players: 1,
        hostNickname: 'A',
      }),
    ]);
    expect(service.roomOf('a')).toBe(snap.state.code);
  });

  it('private rooms stay out of the list; the host can switch', () => {
    const code = service.create(player('a'), 's1', false).state.code;
    expect(publisher.publicList()).toEqual([]);
    service.setVisibility('a', true);
    expect(publisher.publicList().map((r) => r.code)).toEqual([code]);
    service.join(code, player('b'), 's2');
    expect(() => service.setVisibility('b', false)).toThrow(DomainError);
  });

  it('limits rooms and one room per user', () => {
    service.create(player('a'), 's');
    expect(() => service.create(player('a'), 's')).toThrow(/já está na sala/);
    service.create(player('b'), 's');
    service.create(player('c'), 's');
    expect(() => service.create(player('d'), 's')).toThrow(/Muitas salas/);
  });

  it('joining gives the next free seat and a distinct color', () => {
    const code = roomWith(1, false);
    const snap = service.join(code, player('b'), 's-b');
    expect(snap.mySeat).toBe(1);
    expect(snap.state.seats[1]!.color).toBe(1);
    expect(publisher.count('bomber:player_joined')).toBe(1);
    expect(() => service.join('ZZZZZZ', player('c'), 's')).toThrow(
      /não encontrada/,
    );
  });

  it('joining again is a reconnection to the same seat', () => {
    const code = roomWith(2, false);
    service.disconnect('b', 's-b');
    expect(state().seats[1]!.connected).toBe(false);
    const snap = service.join(code, player('b'), 's-b2');
    expect(snap.mySeat).toBe(1);
    expect(state().seats[1]!.connected).toBe(true);
    expect(publisher.count('bomber:player_reconnected')).toBe(1);
  });

  it('frees the seat when the reconnection window expires', () => {
    const code = roomWith(2, false);
    service.join(code, player('b'), 's-b-tab2');
    service.disconnect('b', 's-b');
    expect(timer.scheduled(GRACE)).toBe(0); // another tab still open
    service.disconnect('b', 's-b-tab2');
    timer.fire(GRACE);
    expect(state().seats[1]).toBeNull();
    expect(publisher.last('bomber:player_left')).toMatchObject({
      seat: 1,
      reason: 'expired',
    });
    service.disconnect('ghost', 's');
  });

  it('moves the host to a connected human', () => {
    const code = roomWith(2, false);
    service.addBot('a');
    service.disconnect('a', 's-a');
    expect(state().hostId).toBe('b');
    service.leave('b');
    expect(state().hostId).toBe('a');
    service.join(code, player('a'), 's-a2');
    expect(state().hostId).toBe('a');
  });

  it('deletes the room when the last human leaves, even with bots', () => {
    roomWith(1, false);
    service.addBot('a');
    service.leave('a');
    expect(publisher.publicList()).toEqual([]);
    expect(() => service.sync('a')).toThrow(/não está em uma sala/);
  });

  it('host manages CPU seats; bots are always ready', () => {
    const code = roomWith(1, false);
    service.join(code, player('b'), 's-b');
    service.addBot('a');
    expect(state().seats[2]).toMatchObject({
      bot: true,
      ready: true,
      nickname: 'CPU 1',
      userId: 'cpu:1',
    });
    expect(() => service.addBot('b')).toThrow(DomainError);
    expect(() => service.removeBot('a', 1)).toThrow(/não é da CPU/);
    service.removeBot('a', 2);
    expect(state().seats[2]).toBeNull();
    expect(publisher.last('bomber:player_left')).toMatchObject({
      reason: 'removed',
    });
  });

  it('a full room refuses players and bots', () => {
    const code = roomWith(1, false);
    for (let i = 0; i < 7; i++) service.addBot('a');
    expect(() => service.addBot('a')).toThrow(/cheia/);
    expect(() => service.join(code, player('z'), 's')).toThrow(/cheia/);
    expect(publisher.publicList()).toEqual([]);
  });

  it('colors are unique per room', () => {
    const code = roomWith(2, false);
    service.setColor('a', 5);
    expect(state().seats[0]!.color).toBe(5);
    expect(() => service.setColor('b', 5)).toThrow(/já foi escolhida/);
    const version = state().version;
    service.setColor('a', 5);
    expect(state().version).toBe(version);
    expect(code).toHaveLength(6);
  });

  it('host sets the rules in the lobby', () => {
    roomWith(1, false);
    service.setRules('a', { winsToWin: 1 });
    expect(state().rules.winsToWin).toBe(1);
  });

  it('start needs the host, two players, everybody ready and connected', () => {
    roomWith(1, false);
    expect(() => service.start('a')).toThrow(/pelo menos 2/);
    service.addBot('a');
    expect(() => service.start('a')).toThrow(/prontos/);
    service.setReady('a', true);
    expect(state().lobbyStatus).toBe('READY_TO_START');
    const code = service.roomOf('a')!;
    service.join(code, player('b'), 's-b');
    service.setReady('b', true);
    expect(() => service.start('b')).toThrow(/anfitrião/);
    service.disconnect('b', 's-b');
    expect(() => service.start('a')).toThrow(/reconectar/);
  });

  it('runs rounds at the tick rate and sends frames', () => {
    const code = roomWith(2);
    service.start('a');
    expect(state().phase).toBe('PLAYING');
    expect(publisher.count('bomber:match_started')).toBe(1);
    expect(publisher.last('bomber:round_started')).toMatchObject({
      roundNumber: 1,
    });
    expect(publisher.frames).toHaveLength(1);
    timer.fire(BOMBER_TICK_MS);
    expect(publisher.frames).toHaveLength(2);
    expect(service.sync('b').frame).toMatchObject({
      roundNumber: 1,
      events: [],
    });
    expect(() => service.join(code, player('z'), 's')).toThrow(/já começou/);
    expect(publisher.publicList()).toEqual([]);
  });

  it('forwards inputs to the running round only', () => {
    roomWith(2);
    service.input('a', { s: 1, d: 4, b: false, a: false });
    service.input('nobody', { s: 1, d: 4, b: false, a: false });
    service.start('a');
    for (let i = 0; i < 80; i++) timer.fire(BOMBER_TICK_MS); // countdown
    service.input('a', { s: 7, d: 0, b: false, a: false });
    timer.fire(BOMBER_TICK_MS);
    const frame = publisher.frames[publisher.frames.length - 1];
    expect(frame.players.find((p) => p[0] === 0)![8]).toBe(7);
  });

  it('a leaving player dies in the arena; the round winner scores', () => {
    roomWith(3);
    service.start('a');
    service.leave('c');
    expect(publisher.frames.length).toBeGreaterThan(0);
    service.leave('b');
    playRound();
    const ended = publisher.last('bomber:round_ended');
    expect(ended.winner).toBe(0);
    // Only one bomber left: the match is decided.
    expect(state().phase).toBe('FINISHED');
    expect(publisher.last('bomber:match_over')).toMatchObject({ winner: 0 });
    expect(arena.settleSafe).toHaveBeenCalledTimes(1);
    expect(arena.settleSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        game: 'BOMBER',
        participants: [
          { userId: 'a', placement: 1, abandoned: false },
          { userId: 'b', placement: 2, abandoned: true },
          { userId: 'c', placement: 2, abandoned: true },
        ],
      }),
    );
  });

  it('plays rounds until someone reaches the wins needed, then rematch', () => {
    roomWith(1, false);
    service.addBot('a');
    service.setRules('a', { winsToWin: 2 });
    service.setReady('a', true);
    service.start('a');
    for (let round = 0; round < 12 && state().phase === 'PLAYING'; round++) {
      playRound();
      timer.fire(PAUSE);
    }
    expect(state().phase).toBe('FINISHED');
    const result = state().result!;
    expect(result.wins[result.winner]).toBe(2);
    expect(() => service.rematch('a')).not.toThrow();
    expect(state().phase).toBe('LOBBY');
    expect(state().seats[0]!.ready).toBe(false);
    expect(state().seats[1]!.ready).toBe(true);
  }, 30_000);

  it('when a round leaves one bomber seated, that one takes the match', () => {
    roomWith(2);
    service.start('a');
    playRound(1); // still counting down
    service.leave('b');
    playRound();
    expect(publisher.last('bomber:round_ended')).toMatchObject({ winner: 0 });
    expect(publisher.last('bomber:match_over')).toMatchObject({ winner: 0 });
  });

  it('leaving during the pause between rounds ends the match when one is left', () => {
    const code = roomWith(2);
    service.start('a');
    const rooms = (
      service as unknown as { rooms: Map<string, { round: BomberRound }> }
    ).rooms;
    const round = rooms.get(code)!.round;
    round.kill(round.player(1)!, 'fire');
    playRound();
    expect(state().phase).toBe('PLAYING');
    expect(timer.scheduled(PAUSE)).toBe(1);
    service.leave('b');
    expect(state().phase).toBe('FINISHED');
    expect(state().result).toEqual({
      winner: 0,
      wins: [1, 0, 0, 0, 0, 0, 0, 0],
    });
    timer.fire(PAUSE);
    expect(state().phase).toBe('FINISHED');
  });

  it('rejects lobby actions during a match', () => {
    roomWith(2);
    service.start('a');
    expect(() => service.setReady('a', false)).toThrow(/indisponível/);
    expect(() => service.rematch('a')).toThrow(/indisponível/);
    expect(() => service.leave('zz')).toThrow(/não está/);
  });
});

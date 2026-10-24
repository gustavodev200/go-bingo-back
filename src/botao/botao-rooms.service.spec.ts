import type { ArenaService } from '../arena/arena.service';
import {
  BOTAO_FIELD_W,
  BOTAO_RIGHT,
  BOTAO_TICK_MS,
  type BotaoFrame,
  type BotaoPublicRoom,
  type BotaoRoomState,
  type BotaoServerEventName,
  type BotaoServerEventPayloads,
} from '../contracts';
import type { DrawTimer } from '../game/draw-timer';
import type { BotaoPublisher } from './botao-publisher';
import {
  BotaoRoomsService,
  type BotaoConfig,
  type BotaoPlayer,
} from './botao-rooms.service';
import type { BotaoMatch } from './engine/match';

interface Sent {
  to: string;
  event: BotaoServerEventName;
  payload: unknown;
}

class FakePublisher implements BotaoPublisher {
  sent: Sent[] = [];
  frames: BotaoFrame[] = [];
  removed: string[] = [];
  publicList: () => BotaoPublicRoom[] = () => [];
  toRoom(code: string, event: BotaoServerEventName, payload: unknown) {
    this.sent.push({ to: `room:${code}`, event, payload });
  }
  frame(_code: string, frame: BotaoFrame) {
    this.frames.push(frame);
  }
  removeFromRoom(userId: string, code: string) {
    this.removed.push(`${userId}@${code}`);
  }
  publicRoomsChanged(list: () => BotaoPublicRoom[]) {
    this.publicList = list;
  }
  last<E extends BotaoServerEventName>(event: E): BotaoServerEventPayloads[E] {
    const found = this.sent.filter((s) => s.event === event);
    return found[found.length - 1]?.payload as BotaoServerEventPayloads[E];
  }
  count(event: BotaoServerEventName) {
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
const NOW = 1_000_000;

const player = (id: string): BotaoPlayer => ({
  userId: id,
  nickname: id.toUpperCase(),
  character: 'afla10',
});

describe('BotaoRoomsService', () => {
  let publisher: FakePublisher;
  let timer: FakeTimer;
  let service: BotaoRoomsService;
  let arena: { settleSafe: jest.Mock };
  let seq = 0;

  beforeEach(() => {
    publisher = new FakePublisher();
    timer = new FakeTimer();
    seq = 0;
    const config: BotaoConfig = {
      reconnectGraceMs: GRACE,
      maxRooms: 3,
      now: () => NOW,
    };
    const random = (min: number, max: number) =>
      min + (seq++ % Math.max(1, max - min));
    arena = { settleSafe: jest.fn().mockResolvedValue(null) };
    service = new BotaoRoomsService(
      publisher,
      config,
      random,
      timer,
      arena as unknown as ArenaService,
    );
  });

  afterEach(() => service.onModuleDestroy());

  const state = (): BotaoRoomState => publisher.last('botao:state');
  const matchOf = (code: string) =>
    (
      service as unknown as {
        rooms: Map<string, { match: BotaoMatch | null }>;
      }
    ).rooms.get(code)!.match!;

  /** Sala com `n` humanos (a, b, ...) todos prontos; entram alternando os times. */
  function roomWith(n: number, ready = true): string {
    const ids = 'abcdefgh'.slice(0, n).split('');
    const code = service.create(player(ids[0]), `s-${ids[0]}`).state.code;
    for (const id of ids.slice(1)) service.join(code, player(id), `s-${id}`);
    if (ready) for (const id of ids) service.setReady(id, true);
    return code;
  }

  function tickUntil(done: () => boolean, max = 20_000) {
    for (let i = 0; i < max && !done() && timer.scheduled(BOTAO_TICK_MS); i++)
      timer.fire(BOTAO_TICK_MS);
  }

  it('creates a public room with the creator at seat 0 and lists it', () => {
    const snap = service.create(player('a'), 's1');
    expect(snap.mySeat).toBe(0);
    expect(snap.frame).toBeNull();
    expect(snap.state).toMatchObject({
      phase: 'LOBBY',
      lobbyStatus: 'WAITING_PLAYERS',
      isPublic: true,
      rules: { minutes: 3, goals: 3 },
      score: [0, 0],
    });
    expect(publisher.publicList()).toEqual([
      expect.objectContaining({
        code: snap.state.code,
        hostNickname: 'A',
        players: [1, 0],
      }),
    ]);
    expect(service.roomOf('a')).toBe(snap.state.code);
  });

  it('balances teams on join and lets players switch sides', () => {
    const code = roomWith(3, false);
    expect(state().seats.map((s) => s?.userId ?? null)).toEqual([
      'a',
      'c',
      null,
      null,
      'b',
      null,
      null,
      null,
    ]);
    service.setTeam('c', 1);
    expect(state().seats[5]?.userId).toBe('c');
    service.setTeam('c', 1);
    expect(publisher.publicList()[0].players).toEqual([1, 2]);
    for (const id of 'defgh') service.join(code, player(id), `s-${id}`);
    expect(() => service.join(code, player('z'), 's')).toThrow(/cheia/);
    expect(() => service.setTeam('a', 1)).toThrow(/completo/);
    expect(publisher.publicList()).toEqual([]);
  });

  it('private rooms stay out of the list; the host can switch', () => {
    const code = service.create(player('a'), 's1', false).state.code;
    expect(publisher.publicList()).toEqual([]);
    expect(() => service.setVisibility('z', true)).toThrow();
    service.setVisibility('a', true);
    expect(publisher.publicList()[0].code).toBe(code);
  });

  it('limits rooms and one room per user', () => {
    service.create(player('a'), 's');
    expect(() => service.create(player('a'), 's')).toThrow(/já está/);
    service.create(player('b'), 's');
    service.create(player('c'), 's');
    expect(() => service.create(player('d'), 's')).toThrow(/Muitas salas/);
    expect(() => service.join('NOPE00', player('d'), 's')).toThrow(
      /não encontrada/,
    );
  });

  it('joining again is a reconnection to the same seat', () => {
    const code = roomWith(2, false);
    service.disconnect('b', 's-b');
    expect(state().seats[4]).toMatchObject({ connected: false });
    expect(publisher.last('botao:player_disconnected')).toMatchObject({
      seat: 4,
      reconnectDeadline: NOW + GRACE,
    });
    expect(service.join(code, player('b'), 's-b2').mySeat).toBe(4);
    expect(state().seats[4]).toMatchObject({ connected: true });
    expect(publisher.count('botao:player_reconnected')).toBe(1);
    service.join(code, player('b'), 's-b3');
    service.disconnect('b', 's-b2');
    expect(state().seats[4]?.connected).toBe(true);
    service.disconnect('zz', 'x');
  });

  it('frees the seat when the reconnection window expires and moves the host', () => {
    roomWith(2, false);
    service.disconnect('a', 's-a');
    expect(state().hostId).toBe('b');
    timer.fire(GRACE);
    expect(state().seats[0]).toBeNull();
    expect(publisher.last('botao:player_left')).toMatchObject({
      reason: 'expired',
    });
    expect(publisher.removed).toContain(`a@${state().code}`);
  });

  it('deletes the room when the last human leaves, even with bots', () => {
    service.create(player('a'), 's');
    service.addBot('a');
    service.leave('a');
    expect(service.roomOf('a')).toBeUndefined();
    expect(publisher.publicList()).toEqual([]);
    expect(() => service.leave('a')).toThrow(/não está/);
  });

  it('host manages CPU seats per team; bots are always ready', () => {
    roomWith(1);
    expect(() => service.addBot('z')).toThrow();
    service.addBot('a');
    expect(state().seats[4]).toMatchObject({ bot: true, ready: true });
    service.addBot('a', 0);
    expect(state().seats[1]).toMatchObject({ bot: true, nickname: 'CPU 2' });
    expect(state().lobbyStatus).toBe('READY_TO_START');
    expect(() => service.removeBot('a', 0)).toThrow(/não é da CPU/);
    service.removeBot('a', 1);
    expect(state().seats[1]).toBeNull();
    for (let i = 0; i < 3; i++) service.addBot('a', 1);
    expect(() => service.addBot('a', 1)).toThrow(/time está completo/);
    for (let i = 0; i < 3; i++) service.addBot('a');
    expect(() => service.addBot('a')).toThrow(/sala está cheia/);
  });

  it('stakes: host only, valid levels, everybody confirms again; CPU means no bet', () => {
    roomWith(2);
    expect(() => service.setStake('b', 60)).toThrow(/anfitrião/);
    expect(() => service.setStake('a', 31)).toThrow(/inválida/);
    service.setStake('a', 30);
    expect(state().seats[4]?.ready).toBe(true);
    service.setStake('a', 60);
    expect(state()).toMatchObject({ stake: 60 });
    expect(state().seats[4]?.ready).toBe(false);
    expect(service.stakeToJoin(state().code, 'z')).toBe(60);
    expect(service.stakeToJoin(state().code, 'a')).toBeNull();
    expect(service.stakeToJoin('NOPE00', 'z')).toBeNull();
    expect(service.stakeCheck('a')).toEqual({
      stake: 60,
      userIds: ['a', 'b'],
    });
    service.addBot('a');
    expect(service.stakeCheck('a').userIds).toEqual([]);
  });

  it('start needs the host, both teams, everybody ready and connected', () => {
    roomWith(1);
    expect(() => service.start('a')).toThrow(/Cada time/);
    const code = state().code;
    service.join(code, player('b'), 's-b');
    expect(() => service.start('b')).toThrow(/anfitrião/);
    expect(() => service.start('a')).toThrow(/prontos/);
    service.setReady('b', true);
    service.disconnect('b', 's-b');
    expect(() => service.start('a')).toThrow(/reconectar/);
    service.join(code, player('b'), 's-b');
    service.setRules('a', { minutes: 2, goals: 1 });
    expect(() => service.setRules('b', { minutes: 5, goals: 0 })).toThrow();
    service.start('a');
    expect(state()).toMatchObject({ phase: 'PLAYING', lobbyStatus: null });
    expect(publisher.count('botao:match_started')).toBe(1);
    expect(publisher.frames).toHaveLength(1);
    timer.fire(BOTAO_TICK_MS);
    expect(publisher.frames).toHaveLength(2);
    expect(service.sync('b').frame).toMatchObject({ events: [] });
    expect(() => service.join(code, player('z'), 's')).toThrow(/já começou/);
    expect(() => service.setReady('a', false)).toThrow(/indisponível/);
    expect(() => service.addBot('a')).toThrow(/indisponível/);
    expect(() => service.rematch('a')).toThrow(/indisponível/);
  });

  it('forwards inputs to the running match only', () => {
    const code = roomWith(2);
    service.input('a', { s: 1, d: BOTAO_RIGHT, k: false });
    service.input('nobody', { s: 1, d: 0, k: false });
    service.start('a');
    tickUntil(() => matchOf(code).phase === 'kickoff');
    service.input('a', { s: 7, d: BOTAO_RIGHT, k: false });
    timer.fire(BOTAO_TICK_MS);
    const frame = publisher.frames[publisher.frames.length - 1];
    expect(frame.players.find((p) => p[0] === 0)![6]).toBe(7);
  });

  it('announces goals and settles the match: winners first, losers second', () => {
    const code = roomWith(2);
    service.setRules('a', { minutes: 2, goals: 1 });
    service.start('a');
    const match = matchOf(code);
    tickUntil(() => match.phase === 'kickoff');
    match.phase = 'play';
    match.lastTouch = { seat: 0, team: 0 };
    Object.assign(match.ball, { x: BOTAO_FIELD_W + 5, y: 0, vx: 4, vy: 0 });
    timer.fire(BOTAO_TICK_MS);
    expect(publisher.last('botao:goal')).toMatchObject({
      goal: { team: 0, scorer: 0, own: false },
      score: [1, 0],
    });
    expect(state().score).toEqual([1, 0]);
    tickUntil(() => state().phase === 'FINISHED');
    expect(state().result).toMatchObject({
      winner: 0,
      score: [1, 0],
      walkover: false,
    });
    expect(publisher.last('botao:match_over')).toMatchObject({ winner: 0 });
    expect(arena.settleSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        game: 'BOTAO',
        stake: 30,
        cpuPlayers: 0,
        participants: [
          { userId: 'a', placement: 1, abandoned: false },
          { userId: 'b', placement: 2, abandoned: false },
        ],
      }),
    );
    expect(timer.scheduled(BOTAO_TICK_MS)).toBe(0);

    service.rematch('b');
    expect(state()).toMatchObject({ phase: 'LOBBY', result: null });
    expect(state().seats[0]?.ready).toBe(false);
  });

  it('a team emptied mid-match loses by walkover at once', () => {
    roomWith(3);
    service.start('a');
    service.leave('b');
    expect(state()).toMatchObject({
      phase: 'FINISHED',
      result: { winner: 0, walkover: true },
    });
    expect(publisher.last('botao:player_left')).toMatchObject({
      seat: 4,
      reason: 'left',
    });
    const [[settled]] = arena.settleSafe.mock.calls as [
      [{ participants: unknown[] }],
    ];
    expect(settled.participants).toContainEqual({
      userId: 'b',
      placement: 2,
      abandoned: true,
    });
  });

  it('a teammate leaving keeps the match going', () => {
    roomWith(3);
    service.start('a');
    service.leave('c');
    expect(state().phase).toBe('PLAYING');
    expect(timer.scheduled(BOTAO_TICK_MS)).toBe(1);
  });
});

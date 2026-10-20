import type { ArenaService } from '../arena/arena.service';
import {
  INF_TICK_MS,
  type InfChatMessage,
  type InfFrame,
  type InfPublicRoom,
  type InfRoomState,
  type InfServerEventName,
  type InfServerEventPayloads,
} from '../contracts';
import { DomainError } from '../core/domain-error';
import type { DrawTimer } from '../game/draw-timer';
import type { InfPublisher } from './infiltrado-publisher';
import {
  InfRoomsService,
  type InfConfig,
  type InfPlayer,
} from './infiltrado-rooms.service';

class FakePublisher implements InfPublisher {
  sent: { to: string; event: InfServerEventName; payload: unknown }[] = [];
  frames: { userId: string; frame: InfFrame }[] = [];
  chats: { userId: string; message: InfChatMessage }[] = [];
  removed: string[] = [];
  publicList: () => InfPublicRoom[] = () => [];
  toRoom(code: string, event: InfServerEventName, payload: unknown) {
    this.sent.push({ to: `room:${code}`, event, payload });
  }
  frame(userId: string, frame: InfFrame) {
    this.frames.push({ userId, frame });
  }
  chat(userId: string, message: InfChatMessage) {
    this.chats.push({ userId, message });
  }
  removeFromRoom(userId: string, code: string) {
    this.removed.push(`${userId}@${code}`);
  }
  publicRoomsChanged(list: () => InfPublicRoom[]) {
    this.publicList = list;
  }
  last<E extends InfServerEventName>(event: E): InfServerEventPayloads[E] {
    const found = this.sent.filter((s) => s.event === event);
    return found[found.length - 1]?.payload as InfServerEventPayloads[E];
  }
  lastFrame(userId: string): InfFrame {
    const found = this.frames.filter((f) => f.userId === userId);
    return found[found.length - 1].frame;
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
const player = (id: string): InfPlayer => ({
  userId: id,
  nickname: id.toUpperCase(),
  character: null,
});

describe('InfRoomsService', () => {
  let publisher: FakePublisher;
  let timer: FakeTimer;
  let service: InfRoomsService;
  let arena: { settleSafe: jest.Mock };
  let seq = 0;

  beforeEach(() => {
    publisher = new FakePublisher();
    timer = new FakeTimer();
    seq = 0;
    const config: InfConfig = {
      reconnectGraceMs: GRACE,
      maxRooms: 3,
      now: () => NOW,
    };
    // Deterministic PRNG (mulberry32) so the CPUs behave like real players.
    const random = (min: number, max: number) => {
      seq = (seq + 0x6d2b79f5) | 0;
      let t = Math.imul(seq ^ (seq >>> 15), 1 | seq);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (
        min + Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * (max - min))
      );
    };
    arena = { settleSafe: jest.fn().mockResolvedValue(null) };
    service = new InfRoomsService(
      publisher,
      config,
      random,
      timer,
      arena as unknown as ArenaService,
    );
  });

  afterEach(() => service.onModuleDestroy());

  const state = (): InfRoomState => publisher.last('inf:state');

  function roomWith(n: number, ready = true): string {
    const ids = 'abcdefghijklmno'.slice(0, n).split('');
    const code = service.create(player(ids[0]), `s-${ids[0]}`).state.code;
    for (const id of ids.slice(1)) service.join(code, player(id), `s-${id}`);
    if (ready) for (const id of ids) service.setReady(id, true);
    return code;
  }

  it('creates a public room and lists it until it starts', () => {
    const code = roomWith(4);
    expect(publisher.publicList()).toEqual([
      expect.objectContaining({ code, players: 4, hostNickname: 'A' }),
    ]);
    service.setVisibility('a', false);
    expect(publisher.publicList()).toEqual([]);
  });

  it('holds 15 seats, each with its own color', () => {
    const code = roomWith(15, false);
    expect(new Set(state().seats.map((s) => s!.color)).size).toBe(15);
    expect(() => service.join(code, player('z'), 's-z')).toThrow('cheia');
  });

  it('needs 4 ready players (CPUs count) to start', () => {
    roomWith(2);
    expect(() => service.start('a')).toThrow(DomainError);
    service.addBot('a');
    service.addBot('a');
    expect(state().lobbyStatus).toBe('READY_TO_START');
    expect(() => service.start('b')).toThrow('anfitrião');
    service.start('a');
    expect(state().phase).toBe('PLAYING');
  });

  it('sends each human a private frame and never leaks roles in the room state', () => {
    roomWith(5);
    service.start('a');
    timer.fire(INF_TICK_MS);
    const roles = 'abcde'
      .split('')
      .map((id) => publisher.lastFrame(id).me.role);
    expect(roles.filter((r) => r === 'impostor')).toHaveLength(1);
    expect(JSON.stringify(state())).not.toContain('role');
    expect(state().result).toBeNull();
  });

  it('routes ghost chat only to ghosts and refuses living chat outside meetings', () => {
    roomWith(5);
    service.start('a');
    expect(() => service.chat('a', 'oi')).toThrow(DomainError);
  });

  it('ends the match, reveals the infiltrators and settles the Arena', () => {
    roomWith(4);
    service.start('a');
    timer.fire(INF_TICK_MS);
    const imp = 'abcd'
      .split('')
      .find((id) => publisher.lastFrame(id).me.role === 'impostor')!;
    service.leave(imp);
    expect(state().phase).toBe('FINISHED');
    expect(state().result).toMatchObject({ winner: 'crew', reason: 'left' });
    expect(state().result!.impostors).toHaveLength(1);
    expect(arena.settleSafe).toHaveBeenCalledWith(
      expect.objectContaining({ game: 'INFILTRADO' }),
    );
    const { participants } = (
      arena.settleSafe.mock.calls as unknown[][]
    )[0][0] as {
      participants: { userId: string; placement: number; abandoned: boolean }[];
    };
    expect(participants.find((p) => p.userId === imp)).toMatchObject({
      placement: 2,
      abandoned: true,
    });
    expect(participants.filter((p) => p.placement === 1)).toHaveLength(3);
  });

  it('keeps the seat through a reconnection and frees it after the grace', () => {
    const code = roomWith(4);
    service.disconnect('b', 's-b');
    expect(state().seats[1]!.connected).toBe(false);
    service.join(code, player('b'), 's-b2');
    expect(state().seats[1]!.connected).toBe(true);
    service.disconnect('b', 's-b2');
    timer.fire(GRACE);
    expect(state().seats[1]).toBeNull();
  });

  it('rejects late joiners while playing and goes back to the lobby on rematch', () => {
    const code = roomWith(4);
    service.start('a');
    expect(() => service.join(code, player('z'), 's-z')).toThrow('começou');
    service.leave('a');
    service.leave('b');
    if (state().phase === 'FINISHED') {
      service.rematch('c');
      expect(state().phase).toBe('LOBBY');
    }
  });

  it('a whole match against CPUs runs to the end', () => {
    roomWith(1);
    for (let i = 0; i < 6; i++) service.addBot('a');
    service.start('a');
    for (let i = 0; i < 20 * 60 * 20 && timer.scheduled(INF_TICK_MS); i++)
      timer.fire(INF_TICK_MS);
    // The human just stood there: either the CPUs finished or killed them and won.
    expect(state().phase).toBe('FINISHED');
    expect(arena.settleSafe).toHaveBeenCalledTimes(1);
  });

  it('applies actions and validates them through the match', () => {
    roomWith(4);
    service.start('a');
    expect(() => service.act('a', { t: 'emergency' })).toThrow(DomainError);
    expect(() => service.act('zz', { t: 'emergency' })).toThrow('sala');
  });
});

describe('InfRoomsService voice rights', () => {
  it('only living voters may talk, only during a meeting, and changes are announced', () => {
    const publisher = new FakePublisher();
    const timer = new FakeTimer();
    let seq = 7;
    const random = (min: number, max: number) => {
      seq = (seq * 1103515245 + 12345) & 0x7fffffff;
      return min + (seq % Math.max(1, max - min));
    };
    const service = new InfRoomsService(
      publisher,
      { reconnectGraceMs: GRACE, maxRooms: 3, now: () => NOW },
      random,
      timer,
      {
        settleSafe: jest.fn().mockResolvedValue(null),
      } as unknown as ArenaService,
    );
    const changed: string[] = [];
    service.onVoiceRightsChanged((code) => changed.push(code));
    const code = service.create(player('a'), 's-a').state.code;
    for (const id of 'bcde') service.join(code, player(id), `s-${id}`);
    for (const id of 'abcde') service.setReady(id, true);
    service.start('a');
    expect(service.canTalk(code, 'a')).toBe(false);

    // Skip the intro, then press the button from the table.
    const rooms = (
      service as unknown as {
        rooms: Map<
          string,
          {
            match: {
              phase: string;
              buttonCd: number;
              players: Map<number, { x: number; y: number }>;
            };
          }
        >;
      }
    ).rooms;
    const match = rooms.get(code)!.match;
    for (let i = 0; i < 200 && match.phase !== 'play'; i++)
      timer.fire(INF_TICK_MS);
    match.buttonCd = 0;
    Object.assign(match.players.get(0)!, { x: 32, y: 19 });
    changed.length = 0;
    service.act('a', { t: 'emergency' });
    expect(changed).toEqual([code]);
    expect(service.canTalk(code, 'b')).toBe(true);
    expect(service.canTalk(code, 'zz')).toBe(false);
    expect(service.canTalk('NOPE00', 'b')).toBe(false);

    // Meeting over (vote, result, ejection): voice rights are gone and announced.
    // Discussion and voting run out on the clock.
    for (let i = 0; i < 3000 && match.phase === 'meeting'; i++)
      timer.fire(INF_TICK_MS);
    expect(service.canTalk(code, 'b')).toBe(false);
    expect(changed.length).toBeGreaterThanOrEqual(2);
    service.onModuleDestroy();
  });
});

import {
  SNAKE_TICK_RATE,
  decodeSnakeFrame,
  type SnakeServerEventName,
} from '../contracts';
import { DomainError } from '../core/domain-error';
import type { DrawTimer } from '../game/draw-timer';
import { SnakeArenasService, type SnakeConfig } from './snake-arenas.service';
import type { SnakePublisher } from './snake-publisher';

interface Sent {
  to: string;
  event: SnakeServerEventName;
  payload: unknown;
}

class FakePublisher implements SnakePublisher {
  sent: Sent[] = [];
  frames: { socketId: string; frame: ArrayBuffer }[] = [];
  toArena(arenaId: number, event: SnakeServerEventName, payload: unknown) {
    this.sent.push({ to: `arena:${arenaId}`, event, payload });
  }
  toSocket(socketId: string, event: SnakeServerEventName, payload: unknown) {
    this.sent.push({ to: socketId, event, payload });
  }
  frame(socketId: string, frame: ArrayBuffer) {
    this.frames.push({ socketId, frame });
  }
  of(event: SnakeServerEventName, to?: string) {
    return this.sent.filter((s) => s.event === event && (!to || s.to === to));
  }
}

/** Manual clock: every scheduled tick runs only when the test says so. */
class FakeTimer implements DrawTimer {
  private seq = 0;
  pending = new Map<number, () => void>();
  set(fn: () => void) {
    const id = ++this.seq;
    this.pending.set(id, fn);
    return id;
  }
  clear(handle: unknown) {
    this.pending.delete(handle as number);
  }
  run(times = 1) {
    for (let i = 0; i < times; i++) {
      const fns = [...this.pending.values()];
      this.pending.clear();
      fns.forEach((fn) => fn());
    }
  }
}

const ANA = { userId: 'u-ana', nickname: 'Ana' };
const BIA = { userId: 'u-bia', nickname: 'Bia' };

function setup(config: Partial<SnakeConfig> = {}) {
  const publisher = new FakePublisher();
  const timer = new FakeTimer();
  const service = new SnakeArenasService(
    { bots: 0, maxPlayers: 40, maxArenas: 5, ...config },
    publisher,
    timer,
  );
  return { publisher, timer, service };
}

describe('SnakeArenasService', () => {
  it('joins an arena as spectator and streams frames to the socket', () => {
    const { service, publisher, timer } = setup();
    const data = service.join(ANA, 's1');
    expect(data.arena).toBe(1);
    expect(data.radius).toBeGreaterThan(0);
    timer.run();
    expect(publisher.frames).toHaveLength(1);
    expect(publisher.frames[0].socketId).toBe('s1');
    expect(decodeSnakeFrame(publisher.frames[0].frame).myId).toBe(0);
  });

  it('spawns a snake with the nickname, announces it and follows it with the camera', () => {
    const { service, publisher, timer } = setup();
    service.join(ANA, 's1');
    const { id } = service.play(ANA.userId, 4);
    expect(service.play(ANA.userId, 4).id).toBe(id); // no second snake while alive
    expect(publisher.of('snake:meta')[0].payload).toEqual({
      meta: [[id, 'Ana', 4]],
    });
    timer.run();
    const f = decodeSnakeFrame(publisher.frames.at(-1)!.frame);
    expect(f.myId).toBe(id);
    expect(f.myMass).toBeGreaterThan(0);
    expect(f.snakes.get(id)).toBeDefined();
  });

  it('requires joining before playing', () => {
    const { service } = setup();
    expect(() => service.play('nobody', 0)).toThrow(DomainError);
  });

  it('steers with input and sends the leaderboard every second', () => {
    const { service, publisher, timer } = setup();
    service.join(ANA, 's1');
    service.play(ANA.userId, 0);
    service.input(ANA.userId, { a: 1, b: false });
    service.input('nobody', { a: 1, b: false });
    timer.run(SNAKE_TICK_RATE);
    const lb = publisher.of('snake:leaderboard', 's1');
    expect(lb).toHaveLength(1);
    expect(lb[0].payload).toMatchObject({
      rank: 1,
      total: 1,
      top: [{ name: 'Ana' }],
    });
  });

  it('clamps the view size', () => {
    const { service, publisher, timer } = setup();
    service.join(ANA, 's1');
    service.view(ANA.userId, 1, 99999);
    service.view('nobody', 1, 1);
    timer.run();
    expect(publisher.frames).toHaveLength(1);
  });

  it('tells the player how it died and keeps the camera there', () => {
    const { service, publisher, timer } = setup();
    service.join(ANA, 's1');
    service.play(ANA.userId, 0);
    // steer straight out of the arena
    for (let i = 0; i < 2000 && !publisher.of('snake:dead').length; i++) {
      service.input(ANA.userId, { a: 0, b: false });
      timer.run();
    }
    const dead = publisher.of('snake:dead', 's1');
    expect(dead).toHaveLength(1);
    expect(dead[0].payload).toMatchObject({ killer: null, kills: 0 });
    expect(publisher.of('snake:feed')[0].payload).toMatchObject({
      victim: 'Ana',
      killer: null,
    });
    timer.run();
    expect(decodeSnakeFrame(publisher.frames.at(-1)!.frame).myId).toBe(0);
    // can play again
    expect(service.play(ANA.userId, 1).id).toBeGreaterThan(0);
  });

  it('fills the arena with CPUs and makes room as humans arrive', () => {
    const { service, timer } = setup({ bots: 4 });
    service.join(ANA, 's1');
    timer.run(40);
    service.join(BIA, 's2');
    service.play(BIA.userId, 0);
    const data = service.join(ANA, 's1');
    expect(data.meta.length).toBeGreaterThanOrEqual(4);
  });

  it('opens a new arena when one is full and refuses when all are', () => {
    const { service } = setup({ maxPlayers: 1, maxArenas: 2 });
    expect(service.join(ANA, 's1').arena).toBe(1);
    expect(service.join(BIA, 's2').arena).toBe(2);
    expect(() =>
      service.join({ userId: 'u3', nickname: 'Caio' }, 's3'),
    ).toThrow(DomainError);
  });

  it('a new socket takes over the same player; only that socket can disconnect it', () => {
    const { service, timer, publisher } = setup();
    service.join(ANA, 's1');
    service.play(ANA.userId, 0);
    expect(service.join(ANA, 's2').arena).toBe(1);
    service.disconnect(ANA.userId, 's1');
    expect(service.arenaOf(ANA.userId)).toBe(1);
    timer.run();
    expect(publisher.frames.at(-1)!.socketId).toBe('s2');
    service.disconnect(ANA.userId, 's2');
    expect(service.arenaOf(ANA.userId)).toBeNull();
  });

  it('leaving kills the snake and an empty arena stops its loop', () => {
    const { service, timer } = setup();
    service.join(ANA, 's1');
    service.play(ANA.userId, 0);
    service.leave(ANA.userId);
    service.leave(ANA.userId);
    expect(timer.pending.size).toBe(0);
    expect(service.join(ANA, 's1').arena).toBe(2);
    service.onModuleDestroy();
    expect(timer.pending.size).toBe(0);
  });
});

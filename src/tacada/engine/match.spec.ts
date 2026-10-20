import {
  simulateShot,
  type TacadaBallPos,
  type TacadaGroup,
} from '../../contracts';
import { TacadaMatch, type TacadaShotInput } from './match';

const random = (min: number) => min;

/** Table with only the given balls (index = number). */
function table(entries: Record<number, [number, number]>): TacadaBallPos[] {
  const balls: TacadaBallPos[] = Array.from({ length: 16 }, () => null);
  for (const [k, v] of Object.entries(entries)) balls[Number(k)] = v;
  return balls;
}

const D = Math.SQRT1_2;
/** Cue at (170,30) driving the ball at (190,10) into the top-right pocket (2). */
const CORNER_SHOT: TacadaShotInput = {
  dirX: D,
  dirY: -D,
  power: 0.45,
  spinX: 0,
  spinY: 0,
};
/** Cue at (100,50) driving the ball at (100,20) into the top side pocket (1). */
const SIDE_SHOT: TacadaShotInput = {
  dirX: 0,
  dirY: -1,
  power: 0.4,
  spinX: 0,
  spinY: 0,
};

function match(
  balls: TacadaBallPos[],
  groups: (TacadaGroup | null)[] = [null, null],
) {
  return new TacadaMatch(random, [0, 1], balls, { breakShot: false, groups });
}

describe('TacadaMatch', () => {
  it('racks 15 balls with the 8 in the middle and the breaker holding the cue', () => {
    const m = new TacadaMatch(random, [1, 0]);
    const v = m.publicView();
    expect(v.balls.filter(Boolean)).toHaveLength(16);
    expect(v).toMatchObject({
      turn: 1,
      breakShot: true,
      ballInHand: true,
      groups: [null, null],
      onEight: false,
    });
  });

  it('assigns the group of the first ball pocketed on an open table and keeps the turn', () => {
    const m = match(
      table({ 0: [170, 30], 3: [190, 10], 12: [60, 80], 8: [100, 70] }),
    );
    m.shoot(0, CORNER_SHOT);
    const v = m.publicView();
    expect(v.lastShot).toMatchObject({
      pocketed: [3],
      foul: null,
      keepsTurn: true,
    });
    expect(v.groups).toEqual(['solids', 'stripes']);
    expect(v.turn).toBe(0);
    expect(m.animationMs).toBeGreaterThan(0);
  });

  it('passes the turn when nothing of yours drops', () => {
    const m = match(
      table({ 0: [170, 30], 12: [190, 10], 3: [60, 80], 8: [100, 70] }),
      ['solids', 'stripes'],
    );
    // Hitting a stripe first as solids is a foul.
    m.shoot(0, CORNER_SHOT);
    expect(m.publicView()).toMatchObject({
      turn: 1,
      ballInHand: true,
      fouls: [1, 0],
      lastShot: { foul: 'wrong_first', keepsTurn: false },
    });
  });

  it('calls a scratch a foul and takes the cue ball off the table', () => {
    // Cue aimed straight into the side pocket with nothing in the way.
    const m = match(table({ 0: [100, 40], 3: [30, 80], 8: [150, 70] }));
    m.shoot(0, { ...SIDE_SHOT, power: 0.5 });
    const v = m.publicView();
    expect(v.lastShot!.foul).toBe('scratch');
    expect(v.balls[0]).toBeNull();
    expect(v).toMatchObject({ turn: 1, ballInHand: true });
    expect(() => m.shoot(1, SIDE_SHOT)).toThrow('Coloque a bola branca');
    expect(() => m.shoot(1, { ...SIDE_SHOT, cueX: 30, cueY: 80 })).toThrow(
      'A branca não cabe aí',
    );
    m.shoot(1, { ...SIDE_SHOT, cueX: 60, cueY: 50 });
  });

  it('fouls when no ball reaches a rail after the contact', () => {
    // A soft touch: the object ball barely moves.
    const m = match(table({ 0: [100, 50], 3: [100, 44], 8: [150, 70] }));
    m.shoot(0, { ...SIDE_SHOT, power: 0.02 });
    expect(m.publicView().lastShot!.foul).toBe('no_rail');
  });

  it('fouls when the cue ball touches nothing', () => {
    const m = match(table({ 0: [100, 50], 3: [30, 80], 8: [150, 70] }));
    m.shoot(0, { dirX: 1, dirY: 0, power: 0.05, spinX: 0, spinY: 0 });
    expect(m.publicView().lastShot!.foul).toBe('no_hit');
  });

  it('asks to call the pocket once the group is cleared, and wins in the called pocket', () => {
    const m = match(table({ 0: [170, 30], 8: [190, 10], 12: [60, 80] }), [
      'solids',
      'stripes',
    ]);
    expect(m.publicView().onEight).toBe(true);
    expect(() => m.shoot(0, CORNER_SHOT)).toThrow('Cante a caçapa');
    m.shoot(0, { ...CORNER_SHOT, pocket: 2 });
    expect(m.phase).toBe('OVER');
    expect(m.result).toEqual({ winner: 0, reason: 'eight' });
  });

  it('loses when the 8 drops in another pocket than the called one', () => {
    const m = match(table({ 0: [170, 30], 8: [190, 10], 12: [60, 80] }), [
      'solids',
      'stripes',
    ]);
    m.shoot(0, { ...CORNER_SHOT, pocket: 5 });
    expect(m.result).toEqual({ winner: 1, reason: 'eight_wrong_pocket' });
  });

  it('loses when the 8 drops before the group is cleared', () => {
    const m = match(table({ 0: [170, 30], 8: [190, 10], 3: [60, 80] }), [
      'solids',
      'stripes',
    ]);
    m.shoot(0, CORNER_SHOT);
    expect(m.result).toEqual({ winner: 1, reason: 'eight_early' });
  });

  it('puts the 8 back on the foot spot when it drops on the break', () => {
    const m = new TacadaMatch(
      random,
      [0, 1],
      table({ 0: [45, 50], 8: [190, 10], 3: [60, 80] }),
    );
    // Breaking from the kitchen along the line to the 8 at the corner.
    const dx = 190 - 40;
    const dy = 10 - 70;
    const len = Math.sqrt(dx * dx + dy * dy);
    const shot = {
      dirX: dx / len,
      dirY: dy / len,
      power: 0.9,
      spinX: 0,
      spinY: 0,
    };
    const outcome = simulateShot(
      table({ 0: [40, 70], 8: [190, 10], 3: [60, 80] }),
      shot,
    );
    m.shoot(0, { ...shot, cueX: 40, cueY: 70 });
    const v = m.publicView();
    if (outcome.pocketed.some((p) => p.ball === 8)) {
      expect(v.lastShot!.eightRespotted).toBe(true);
      expect(v.balls[8]).not.toBeNull();
    }
    expect(m.phase).toBe('PLAYING');
    expect(v.breakShot).toBe(false);
  });

  it('loses after three fouls in a row', () => {
    const m = match(table({ 0: [100, 50], 3: [30, 80], 8: [150, 70] }));
    m.timeout();
    m.timeout();
    m.timeout();
    m.timeout();
    m.timeout();
    expect(m.result).toEqual({ winner: 1, reason: 'fouls' });
  });

  it('resets the foul count after a clean shot', () => {
    const m = match(
      table({ 0: [170, 30], 3: [190, 10], 12: [60, 80], 8: [100, 70] }),
    );
    m.timeout(); // seat 0 fouls
    m.timeout(); // seat 1 fouls
    expect(m.publicView().fouls).toEqual([1, 1]);
    m.shoot(0, { ...CORNER_SHOT, cueX: 170, cueY: 30 });
    expect(m.publicView().fouls).toEqual([0, 1]);
  });

  it('rejects shots out of turn, without direction or after the end', () => {
    const m = match(table({ 0: [100, 50], 3: [30, 80], 8: [150, 70] }));
    expect(() => m.shoot(1, SIDE_SHOT)).toThrow('Não é a sua vez');
    expect(() => m.shoot(0, { ...SIDE_SHOT, dirY: 0 })).toThrow('Mire');
    m.resign(0);
    expect(m.result).toEqual({ winner: 1, reason: 'resign' });
    expect(() => m.shoot(1, SIDE_SHOT)).toThrow('A partida já terminou');
    expect(m.removePlayer(0)).toEqual([]);
  });
});

describe('Tacada physics', () => {
  it('is deterministic: the same shot gives the same table', () => {
    const balls = new TacadaMatch(random, [0, 1]).publicView().balls.slice();
    balls[0] = [45, 52];
    const shot = { dirX: 1, dirY: 0, power: 1, spinX: 0.3, spinY: -0.5 };
    expect(simulateShot(balls, shot)).toEqual(simulateShot(balls, shot));
  });

  it('draws the cue ball back with backspin and follows with topspin', () => {
    // Straight into the top side pocket: the cue ball comes back, stays or follows.
    const start = table({ 0: [100, 80], 3: [100, 40] });
    const base = { dirX: 0, dirY: -1, power: 0.35, spinX: 0 };
    const draw = simulateShot(start, { ...base, spinY: -1 });
    const stun = simulateShot(start, { ...base, spinY: 0 });
    const follow = simulateShot(start, { ...base, spinY: 1 });
    expect(draw.pocketed).toEqual([{ ball: 3, pocket: 1 }]);
    expect(draw.balls[0]![1]).toBeGreaterThan(70);
    expect(stun.balls[0]![1]).toBeGreaterThan(40);
    expect(stun.balls[0]![1]).toBeLessThan(50);
    expect(follow.balls[0]![1]).toBeLessThan(15);
  });
});

import {
  BOTAO_BALL_R,
  BOTAO_CENTER_R,
  BOTAO_FIELD_H,
  BOTAO_FIELD_W,
  BOTAO_GOAL_H,
  BOTAO_KICK_STRENGTH,
  BOTAO_LEFT,
  BOTAO_PLAYER_R,
  BOTAO_RIGHT,
  BOTAO_TICK_RATE,
  BOTAO_UP,
  botaoCollideDiscs,
  botaoConfineBall,
  botaoConfinePlayer,
  botaoDirFromVector,
  botaoDirVector,
  botaoGoalAt,
  botaoKick,
  botaoMovePlayer,
  botaoNewBall,
  botaoNewPlayer,
  type BotaoRules,
} from '../../contracts';
import { BotaoMatch } from './match';

const RULES: BotaoRules = { minutes: 2, goals: 3 };
const fixed = () => 0.25;

function newMatch(
  seats: { seat: number; bot?: boolean }[] = [{ seat: 0 }, { seat: 4 }],
  rules = RULES,
) {
  return new BotaoMatch(
    seats.map((s) => ({ seat: s.seat, bot: !!s.bot })),
    rules,
    fixed,
  );
}

/** Pula a contagem inicial. */
function toKickoff(m: BotaoMatch) {
  while (m.phase === 'countdown') m.tick();
}

describe('botao physics', () => {
  it('maps direction bits to unit vectors and back', () => {
    expect(botaoDirVector(0)).toEqual([0, 0]);
    expect(botaoDirVector(BOTAO_RIGHT)).toEqual([1, 0]);
    expect(botaoDirVector(BOTAO_LEFT | BOTAO_RIGHT)).toEqual([0, 0]);
    const [x, y] = botaoDirVector(BOTAO_UP | BOTAO_RIGHT);
    expect(x).toBeCloseTo(Math.SQRT1_2);
    expect(y).toBeCloseTo(-Math.SQRT1_2);
    expect(botaoDirFromVector(10, 0)).toBe(BOTAO_RIGHT);
    expect(botaoDirFromVector(-5, -5)).toBe(BOTAO_LEFT | BOTAO_UP);
    expect(botaoDirFromVector(1, 1, 5)).toBe(0);
  });

  it('accelerates toward a terminal speed and slows down when kicking', () => {
    const p = botaoNewPlayer(0, 0);
    for (let i = 0; i < 400; i++) botaoMovePlayer(p, BOTAO_RIGHT, false);
    expect(p.vx).toBeCloseTo(2.5, 1);
    const q = botaoNewPlayer(0, 0);
    for (let i = 0; i < 400; i++) botaoMovePlayer(q, BOTAO_RIGHT, true);
    expect(q.vx).toBeLessThan(p.vx);
  });

  it('pushes discs apart and transfers momentum', () => {
    const a = botaoNewPlayer(0, 0);
    const b = botaoNewBall();
    b.x = BOTAO_PLAYER_R + BOTAO_BALL_R - 2;
    a.vx = 2;
    expect(botaoCollideDiscs(a, b)).toBe(true);
    expect(b.x - a.x).toBeCloseTo(BOTAO_PLAYER_R + BOTAO_BALL_R);
    expect(b.vx).toBeGreaterThan(0);
    expect(botaoCollideDiscs(a, b)).toBe(false);
  });

  it('kicks only within reach, along the player→ball line', () => {
    const p = botaoNewPlayer(0, 0);
    const b = botaoNewBall();
    b.x = 40;
    expect(botaoKick(p, b)).toBe(false);
    b.x = BOTAO_PLAYER_R + BOTAO_BALL_R + 2;
    expect(botaoKick(p, b)).toBe(true);
    expect(b.vx).toBeCloseTo(BOTAO_KICK_STRENGTH);
    expect(b.vy).toBeCloseTo(0);
  });

  it('bounces the ball off the touchline and the posts', () => {
    const b = botaoNewBall();
    b.y = BOTAO_FIELD_H - 5;
    b.vy = 3;
    expect(botaoConfineBall(b).wall).toBe(true);
    expect(b.y).toBeCloseTo(BOTAO_FIELD_H - BOTAO_BALL_R);
    expect(b.vy).toBeLessThan(0);
    const c = botaoNewBall();
    c.x = BOTAO_FIELD_W - 12;
    c.y = BOTAO_GOAL_H;
    expect(botaoConfineBall(c).post).toBe(true);
  });

  it('counts a goal only when the whole ball is past the line, inside the mouth', () => {
    const b = botaoNewBall();
    b.x = BOTAO_FIELD_W + 2;
    expect(botaoGoalAt(b)).toBeNull();
    b.x = BOTAO_FIELD_W + BOTAO_BALL_R + 1;
    expect(botaoGoalAt(b)).toBe(1);
    b.x = -b.x;
    expect(botaoGoalAt(b)).toBe(0);
    b.y = BOTAO_GOAL_H + 1;
    expect(botaoGoalAt(b)).toBeNull();
  });

  it('keeps players in their half and out of the center circle at kickoff', () => {
    const red = botaoNewPlayer(30, 100);
    botaoConfinePlayer(red, 0, { kickTeam: 1 });
    expect(red.x).toBeLessThanOrEqual(-BOTAO_PLAYER_R);
    const blue = botaoNewPlayer(20, 0);
    botaoConfinePlayer(blue, 1, { kickTeam: 0 });
    expect(Math.hypot(blue.x, blue.y)).toBeGreaterThanOrEqual(
      BOTAO_CENTER_R + BOTAO_PLAYER_R - 1e-6,
    );
    const kicker = botaoNewPlayer(-20, 0);
    botaoConfinePlayer(kicker, 0, { kickTeam: 0 });
    expect(kicker.x).toBe(-20);
    const far = botaoNewPlayer(9999, -9999);
    botaoConfinePlayer(far, 0, null);
    expect(far.x).toBeLessThan(BOTAO_FIELD_W + 40);
    expect(far.y).toBeGreaterThan(-BOTAO_FIELD_H - 40);
  });
});

describe('BotaoMatch', () => {
  it('starts with a countdown, then waits for the kickoff', () => {
    const m = newMatch();
    expect(m.phase).toBe('countdown');
    expect(m.player(0)!.disc.x).toBeLessThan(0);
    expect(m.player(4)!.disc.x).toBeGreaterThan(0);
    m.pushInput(0, { s: 1, d: BOTAO_RIGHT, k: false });
    m.tick();
    expect(m.player(0)!.queue).toHaveLength(0);
    toKickoff(m);
    expect(m.phase).toBe('kickoff');
    expect(m.frame().events).toContainEqual({ k: 'whistle' });
  });

  it('moves players by their inputs and echoes the last sequence', () => {
    const m = newMatch();
    toKickoff(m);
    const x0 = m.player(4)!.disc.x;
    for (let s = 1; s <= 10; s++)
      m.pushInput(4, { s, d: BOTAO_RIGHT, k: false });
    for (let i = 0; i < 10; i++) m.tick();
    expect(m.player(4)!.disc.x).toBeGreaterThan(x0);
    expect(m.frame().players.find((p) => p[0] === 4)![6]).toBe(10);
  });

  it('a kick starts play; walking the ball in scores, kickoff goes to the other team', () => {
    const m = newMatch();
    toKickoff(m);
    m.kickTeam = 0;
    const red = m.player(0)!;
    Object.assign(red.disc, { x: -27, y: 0 });
    m.pushInput(0, { s: 1, d: BOTAO_RIGHT, k: true });
    m.tick();
    expect(m.phase).toBe('play');
    expect(m.frame().events).toContainEqual({ k: 'kick', seat: 0 });
    expect(m.lastTouch).toEqual({ seat: 0, team: 0 });

    Object.assign(m.ball, { x: BOTAO_FIELD_W - 5, y: 0, vx: 4, vy: 0 });
    for (let i = 0; i < 10 && m.phase === 'play'; i++) m.tick();
    expect(m.phase).toBe('goal');
    expect(m.score).toEqual([1, 0]);
    const goals = m.drainGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ team: 0, scorer: 0, own: false });
    expect(m.drainGoals()).toEqual([]);
    for (let i = 0; i < BOTAO_TICK_RATE * 3 && m.phase === 'goal'; i++)
      m.tick();
    expect(m.phase).toBe('kickoff');
    expect(m.kickTeam).toBe(1);
    expect(m.ball.x).toBe(0);
  });

  it('flags own goals', () => {
    const m = newMatch();
    toKickoff(m);
    m.phase = 'play';
    m.lastTouch = { seat: 4, team: 1 };
    Object.assign(m.ball, { x: BOTAO_FIELD_W + 5, y: 0, vx: 4, vy: 0 });
    m.tick();
    expect(m.goals[0]).toMatchObject({ team: 0, scorer: 4, own: true });
  });

  it('reaching the goal limit ends the match after the celebration', () => {
    const m = newMatch([{ seat: 0 }, { seat: 4 }], { minutes: 2, goals: 1 });
    toKickoff(m);
    m.phase = 'play';
    Object.assign(m.ball, { x: -BOTAO_FIELD_W - 5, y: 0, vx: -4, vy: 0 });
    m.tick();
    expect(m.score).toEqual([0, 1]);
    for (let i = 0; i < BOTAO_TICK_RATE * 3 && !m.result; i++) m.tick();
    expect(m.result).toEqual({ winner: 1, walkover: false });
    expect(m.phase).toBe('over');
    m.tick();
    expect(m.phase).toBe('over');
  });

  it('time up with different scores ends; a draw goes to golden goal', () => {
    const m = newMatch([{ seat: 0 }, { seat: 4 }], { minutes: 2, goals: 0 });
    toKickoff(m);
    m.elapsed = m.totalTime - 0.01;
    m.tick();
    expect(m.phase).toBe('ending');
    for (let i = 0; i < BOTAO_TICK_RATE * 2 && m.phase === 'ending'; i++)
      m.tick();
    expect(m.overtime).toBe(true);
    expect(m.phase).toBe('kickoff');
    m.tick();
    expect(m.frame().clock).toBe(0);

    m.phase = 'play';
    m.lastTouch = { seat: 0, team: 0 };
    Object.assign(m.ball, { x: BOTAO_FIELD_W + 5, y: 0, vx: 4, vy: 0 });
    m.tick();
    for (let i = 0; i < BOTAO_TICK_RATE * 3 && !m.result; i++) m.tick();
    expect(m.result).toEqual({ winner: 0, walkover: false });

    const n = newMatch([{ seat: 0 }, { seat: 4 }], { minutes: 2, goals: 0 });
    toKickoff(n);
    n.score = [2, 1];
    n.elapsed = n.totalTime - 0.01;
    n.tick();
    expect(n.frame().events).toContainEqual({ k: 'end' });
    for (let i = 0; i < BOTAO_TICK_RATE * 3 && !n.result; i++) n.tick();
    expect(n.result).toEqual({ winner: 0, walkover: false });
  });

  it('a team left without players loses by walkover', () => {
    const m = newMatch([{ seat: 0 }, { seat: 1 }, { seat: 4 }]);
    toKickoff(m);
    m.remove(1);
    expect(m.result).toBeNull();
    m.remove(4);
    expect(m.result).toEqual({ winner: 0, walkover: true });
    m.remove(0);
    m.remove(99);
    expect(m.result).toEqual({ winner: 0, walkover: true });
  });

  it('drops the oldest inputs past the queue limit and ignores bots', () => {
    const m = newMatch([{ seat: 0 }, { seat: 4, bot: true }]);
    for (let s = 1; s <= 20; s++) m.pushInput(0, { s, d: 0, k: false });
    expect(m.player(0)!.queue).toHaveLength(8);
    m.pushInput(4, { s: 1, d: 0, k: false });
    expect(m.player(4)!.queue).toHaveLength(0);
    m.pushInput(7, { s: 1, d: 0, k: false });
  });

  it('CPUs play a whole match on their own and someone scores', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const m = new BotaoMatch(
      [
        { seat: 0, bot: true },
        { seat: 1, bot: true },
        { seat: 4, bot: true },
        { seat: 5, bot: true },
      ],
      { minutes: 3, goals: 1 },
      rand,
    );
    for (let i = 0; i < BOTAO_TICK_RATE * 60 * 4 && !m.result; i++) m.tick();
    expect(m.goals.length).toBeGreaterThan(0);
    expect(m.result).not.toBeNull();
  });
});

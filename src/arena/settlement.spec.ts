import { ARENA_RULES } from '../contracts';
import {
  kFactor,
  pairFactor,
  planSettlement,
  potShares,
  rakeOf,
  splitPot,
  type Entrant,
} from './settlement';

function e(id: string, over: Partial<Entrant> = {}): Entrant {
  return {
    userId: id,
    placement: 1,
    abandoned: false,
    logged: true,
    points: 0,
    ratedMatches: 100,
    streak: 0,
    firstWinAvailable: false,
    ...over,
  };
}
const LONG = 10 * 60_000;

describe('potShares', () => {
  it('winner takes all with 2 or 3 players', () => {
    expect(potShares([e('a'), e('b', { placement: 2 })])).toEqual([1, 0]);
    expect(
      potShares([e('a'), e('b', { placement: 2 }), e('c', { placement: 3 })]),
    ).toEqual([1, 0, 0]);
  });

  it('splits 60/30/10 with 4 distinct placements', () => {
    const s = potShares([
      e('a', { placement: 1 }),
      e('b', { placement: 2 }),
      e('c', { placement: 3 }),
      e('d', { placement: 4 }),
    ]);
    expect(s[0]).toBeCloseTo(0.6);
    expect(s[1]).toBeCloseTo(0.3);
    expect(s[2]).toBeCloseTo(0.1);
    expect(s[3]).toBe(0);
  });

  it('shares the pot inside a winning team', () => {
    const s = potShares([
      e('a'),
      e('b', { placement: 2 }),
      e('c'),
      e('d', { placement: 2 }),
    ]);
    expect(s).toEqual([0.5, 0, 0.5, 0]);
  });

  it('never pays someone who left; leftovers go to who stayed', () => {
    const s = potShares([
      e('a', { abandoned: true }),
      e('b', { placement: 2 }),
      e('c', { placement: 3 }),
    ]);
    expect(s[0]).toBe(0);
    expect(s[1] + s[2]).toBeCloseTo(1);
  });
});

describe('splitPot', () => {
  it('always adds up to the pot', () => {
    const parts = splitPot(101, [0.6, 0.3, 0.1, 0]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(101);
    expect(parts[0]).toBeGreaterThanOrEqual(60);
  });
});

describe('pairFactor / kFactor', () => {
  it('decays when the same opponents meet again and again', () => {
    expect(pairFactor(0)).toBe(1);
    expect(pairFactor(3)).toBe(0.5);
    expect(pairFactor(8)).toBe(0);
  });
  it('rookies move faster', () => {
    expect(kFactor(0)).toBeGreaterThan(kFactor(60));
  });
});

describe('planSettlement rating', () => {
  it('beating a stronger player pays more than beating a weaker one', () => {
    const vsStrong = planSettlement({
      game: 'TRUCO',
      durationMs: LONG,
      entrants: [e('a'), e('b', { placement: 2, points: 500 })],
    }).entries[0].pointsDelta;
    const vsWeak = planSettlement({
      game: 'TRUCO',
      durationMs: LONG,
      entrants: [e('a', { points: 500 }), e('b', { placement: 2 })],
    }).entries[0].pointsDelta;
    expect(vsStrong).toBeGreaterThan(vsWeak);
  });

  it('is zero-sum between equals', () => {
    const plan = planSettlement({
      game: 'TRUCO',
      durationMs: LONG,
      entrants: [
        e('a', { points: 300 }),
        e('b', { placement: 2, points: 300 }),
      ],
    });
    expect(plan.entries[0].pointsDelta).toBe(10);
    expect(plan.entries[1].pointsDelta).toBe(-10);
  });

  it('winning always pays at least a little, even against much weaker players', () => {
    const plan = planSettlement({
      game: 'TRUCO',
      durationMs: LONG,
      entrants: [e('a', { points: 2000 }), e('b', { placement: 2 })],
    });
    expect(plan.entries[0].pointsDelta).toBeGreaterThanOrEqual(4);
  });

  it('weights luck games below skill games', () => {
    const mk = (game: 'BINGO' | 'TRUCO') =>
      planSettlement({
        game,
        durationMs: LONG,
        entrants: [e('a'), e('b', { placement: 2 })],
      }).entries[0].pointsDelta;
    expect(mk('BINGO')).toBeLessThan(mk('TRUCO'));
  });

  it('gives no points against guests only, but still moves coins', () => {
    const plan = planSettlement({
      game: 'UNO',
      durationMs: LONG,
      entrants: [e('a'), e('g', { placement: 2, logged: false })],
    });
    expect(plan.rated).toBe(false);
    expect(plan.entries[0].pointsDelta).toBe(0);
    const codes = plan.entries[0].bonuses.map((b) => b.code);
    expect(codes).toContain('WIN');
    expect(codes).not.toContain('FIRST_WIN');
  });

  it('a match shorter than the minimum gives no points or house bonus', () => {
    const plan = planSettlement({
      game: 'UNO',
      durationMs: ARENA_RULES.UNO.minRatedMs - 1,
      entrants: [e('a'), e('b', { placement: 2 })],
    });
    expect(plan.rated).toBe(false);
    expect(plan.entries[0].pointsDelta).toBe(0);
    expect(plan.entries[0].bonuses).toEqual([]);
    expect(plan.entries[0].streakAfter).toBe(0);
  });

  it('farming the same opponent stops paying points and bonuses', () => {
    const plan = planSettlement({
      game: 'UNO',
      durationMs: LONG,
      pairMatches: () => 20,
      entrants: [e('a'), e('b', { placement: 2 })],
    });
    expect(plan.entries[0].pointsDelta).toBe(0);
    expect(plan.entries[1].pointsDelta).toBe(0);
    expect(
      plan.entries[0].bonuses.find((b) => b.code === 'WIN'),
    ).toBeUndefined();
  });

  it('team members share the result and are not opponents of each other', () => {
    const plan = planSettlement({
      game: 'TRUCO',
      durationMs: LONG,
      entrants: [
        e('a'),
        e('b', { placement: 2 }),
        e('c'),
        e('d', { placement: 2 }),
      ],
    });
    expect(plan.entries.map((x) => x.won)).toEqual([true, false, true, false]);
    expect(plan.entries[0].pointsDelta).toBe(plan.entries[2].pointsDelta);
  });
});

describe('planSettlement streaks and bonuses', () => {
  it('stacks streak and first win of the day for a logged winner', () => {
    const plan = planSettlement({
      game: 'TRUCO',
      durationMs: LONG,
      entrants: [
        e('a', { streak: 2, firstWinAvailable: true }),
        e('b', { placement: 2 }),
      ],
    });
    const codes = plan.entries[0].bonuses.map((b) => b.code);
    expect(codes).toEqual(['FINISH', 'WIN', 'STREAK', 'FIRST_WIN']);
    expect(plan.entries[0].streakAfter).toBe(3);
    expect(plan.entries[1].streakAfter).toBe(-1);
  });

  it('pays the comeback bonus after 3 straight losses', () => {
    const plan = planSettlement({
      game: 'TRUCO',
      durationMs: LONG,
      entrants: [e('a', { streak: -3 }), e('b', { placement: 2 })],
    });
    expect(plan.entries[0].bonuses.map((b) => b.code)).toContain('COMEBACK');
    expect(plan.entries[0].streakAfter).toBe(1);
  });

  it('pays the underdog bonus when the opponent is far stronger', () => {
    const plan = planSettlement({
      game: 'TRUCO',
      durationMs: LONG,
      entrants: [e('a'), e('b', { placement: 2, points: 400 })],
    });
    expect(plan.entries[0].bonuses.map((b) => b.code)).toContain('UNDERDOG');
  });

  it('Snake duels do not touch the streak and give no finish bonus', () => {
    const plan = planSettlement({
      game: 'SNAKE',
      durationMs: 60_000,
      entrants: [e('a', { streak: 4 }), e('b', { placement: 2 })],
    });
    expect(plan.entries[0].streakAfter).toBe(4);
    expect(plan.entries[0].bonuses.map((b) => b.code)).toEqual(['WIN']);
  });

  it('a leaver loses, pays a penalty and gets nothing, even in short matches', () => {
    const plan = planSettlement({
      game: 'UNO',
      durationMs: 5_000,
      entrants: [e('a', { abandoned: true }), e('b', { placement: 2 })],
    });
    const [leaver, stayer] = plan.entries;
    expect(leaver.won).toBe(false);
    expect(leaver.penalty).toBe(ARENA_RULES.UNO.ante);
    expect(leaver.bonuses).toEqual([]);
    expect(leaver.streakAfter).toBe(-1);
    expect(stayer.won).toBe(true);
    expect(stayer.potShare).toBe(1);
  });

  it('bonusScale halves the win bonus (bingo line mode)', () => {
    const win = (bonusScale?: number) =>
      planSettlement({
        game: 'BINGO',
        durationMs: LONG,
        bonusScale,
        entrants: [e('a'), e('b', { placement: 2 })],
      }).entries[0].bonuses.find((b) => b.code === 'WIN')!.amount;
    expect(win(0.5)).toBe(win() / 2);
  });
});

describe('table stakes', () => {
  it('uses the table stake as entry and as the abandon fine', () => {
    const plan = planSettlement({
      game: 'UNO',
      durationMs: LONG,
      stake: 150,
      entrants: [e('a'), e('b', { placement: 2, abandoned: true })],
    });
    expect(plan.entries.map((x) => x.stake)).toEqual([150, 150]);
    expect(plan.entries[1].penalty).toBe(150);
  });

  it('defaults to the game minimum', () => {
    const plan = planSettlement({
      game: 'UNO',
      durationMs: LONG,
      entrants: [e('a'), e('b', { placement: 2 })],
    });
    expect(plan.entries[0].stake).toBe(ARENA_RULES.UNO.ante);
  });

  it('bonuses and points do not grow with the stake (ranking measures skill)', () => {
    const at = (stake?: number) =>
      planSettlement({
        game: 'UNO',
        durationMs: LONG,
        stake,
        entrants: [e('a'), e('b', { placement: 2 })],
      }).entries[0];
    expect(at(750).bonuses).toEqual(at().bonuses);
    expect(at(750).pointsDelta).toBe(at().pointsDelta);
  });

  it('rakeOf rounds down and is zero without a rate', () => {
    expect(rakeOf(399, 0.05)).toBe(19);
    expect(rakeOf(400, 0)).toBe(0);
  });
});

import { MatchTracker, rankSeats } from './match-tracker';

describe('MatchTracker', () => {
  it('lists every seated player with their placement and who left', () => {
    const t = new MatchTracker(
      [
        { seat: 0, userId: 'a' },
        { seat: 2, userId: 'b' },
      ],
      1_000,
    );
    t.markLeft(2);
    expect(t.participants((seat) => (seat === 0 ? 1 : 2))).toEqual([
      { userId: 'a', placement: 1, abandoned: false },
      { userId: 'b', placement: 2, abandoned: true },
    ]);
    expect(t.durationMs(61_000)).toBe(60_000);
    expect(t.durationMs(0)).toBe(0);
  });

  it('gives each match its own id', () => {
    expect(new MatchTracker([], 0).matchId).not.toBe(
      new MatchTracker([], 0).matchId,
    );
  });
});

describe('rankSeats', () => {
  it('puts winners first and ranks the rest by score with ties sharing the place', () => {
    const scores = [10, 5, 5, 2];
    const place = rankSeats([0, 1, 2, 3], (s) => scores[s], new Set([0]));
    expect([0, 1, 2, 3].map(place)).toEqual([1, 2, 2, 4]);
  });

  it('keeps a whole winning team at 1', () => {
    const place = rankSeats([0, 1, 2, 3], () => 0, new Set([0, 2]));
    expect([0, 1, 2, 3].map(place)).toEqual([1, 2, 1, 2]);
  });
});

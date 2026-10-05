import {
  columnRange,
  FREE_CELL,
  FREE_INDEX,
  letterFor,
  remainingForFullCard,
} from './bingo';

describe('letterFor', () => {
  it.each([
    [1, 'B'],
    [15, 'B'],
    [16, 'I'],
    [30, 'I'],
    [31, 'N'],
    [45, 'N'],
    [46, 'G'],
    [60, 'G'],
    [61, 'O'],
    [75, 'O'],
  ])('%i → %s', (n, letter) => {
    expect(letterFor(n)).toBe(letter);
  });

  it('rejects numbers outside 1–75', () => {
    expect(() => letterFor(0)).toThrow();
    expect(() => letterFor(76)).toThrow();
  });
});

describe('columnRange', () => {
  it('maps columns to 15-number ranges', () => {
    expect(columnRange(0)).toEqual([1, 15]);
    expect(columnRange(4)).toEqual([61, 75]);
  });
});

describe('remainingForFullCard', () => {
  const grid = Array.from({ length: 25 }, (_, i) =>
    i === FREE_INDEX ? FREE_CELL : i + 1,
  );

  it('ignores the free cell', () => {
    expect(remainingForFullCard(grid, new Set())).toBe(24);
  });

  it('counts only undrawn numbers', () => {
    expect(remainingForFullCard(grid, new Set([1, 2, 3]))).toBe(21);
  });

  it('is zero when every number was drawn', () => {
    expect(remainingForFullCard(grid, new Set(grid))).toBe(0);
  });
});

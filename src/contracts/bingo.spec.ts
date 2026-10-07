import {
  columnRange,
  FREE_CELL,
  FREE_INDEX,
  closestLine,
  letterFor,
  remainingFor,
  remainingForFullCard,
  WIN_LINES,
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

describe('Quina (LINE)', () => {
  const grid = Array.from({ length: 25 }, (_, i) =>
    i === FREE_INDEX ? FREE_CELL : i + 1,
  );

  it('has 5 rows, 5 columns and 2 diagonals, both diagonals through the center', () => {
    expect(WIN_LINES).toHaveLength(12);
    expect(WIN_LINES[10]).toEqual([0, 6, 12, 18, 24]);
    expect(WIN_LINES[11]).toEqual([20, 16, 12, 8, 4]);
  });

  it('needs 4 numbers for lines through the free center and 5 otherwise', () => {
    expect(closestLine(() => false)).toBe(4);
    expect(remainingFor('LINE', grid, new Set())).toBe(4);
  });

  it('is zero once a row is complete (row 0 = indices 0,5,10,15,20)', () => {
    expect(remainingFor('LINE', grid, new Set([1, 6, 11, 16, 21]))).toBe(0);
  });

  it('is zero for an anti-diagonal using the free center', () => {
    expect(remainingFor('LINE', grid, new Set([21, 17, 9, 5]))).toBe(0);
  });

  it('FULL_CARD keeps counting every number', () => {
    expect(remainingFor('FULL_CARD', grid, new Set([1, 6, 11, 16, 21]))).toBe(
      19,
    );
  });
});

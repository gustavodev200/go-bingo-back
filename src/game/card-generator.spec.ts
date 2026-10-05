import { columnRange, FREE_CELL, FREE_INDEX } from '../contracts';
import { cryptoRandomInt } from '../core/random';
import { generateGrid } from './card-generator';

describe('generateGrid', () => {
  it('builds 25 cells with the free cell in the center', () => {
    const grid = generateGrid(cryptoRandomInt);
    expect(grid).toHaveLength(25);
    expect(grid[FREE_INDEX]).toBe(FREE_CELL);
    expect(grid.filter((n) => n === FREE_CELL)).toHaveLength(1);
  });

  it('keeps every column inside its B-I-N-G-O range without repeats', () => {
    for (let run = 0; run < 500; run++) {
      const grid = generateGrid(cryptoRandomInt);
      for (let col = 0; col < 5; col++) {
        const [min, max] = columnRange(col);
        const column = grid
          .slice(col * 5, col * 5 + 5)
          .filter((n) => n !== FREE_CELL);
        expect(new Set(column).size).toBe(column.length);
        column.forEach((n) => {
          expect(n).toBeGreaterThanOrEqual(min);
          expect(n).toBeLessThanOrEqual(max);
        });
      }
    }
  });

  it('is deterministic for a given random source', () => {
    expect(generateGrid(() => 0)).toEqual([
      1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 0, 33, 34, 46, 47, 48, 49, 50,
      61, 62, 63, 64, 65,
    ]);
  });
});

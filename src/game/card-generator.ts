import { columnRange, FREE_CELL } from '../contracts';
import type { RandomInt } from '../core/random';

/** Grade 5×5 coluna-major (index = col * 5 + row), casa livre no centro. */
export function generateGrid(random: RandomInt): number[] {
  const grid: number[] = [];
  for (let col = 0; col < 5; col++) {
    const [min] = columnRange(col);
    const pool = Array.from({ length: 15 }, (_, i) => min + i);
    for (let row = 0; row < 5; row++) {
      if (col === 2 && row === 2) {
        grid.push(FREE_CELL);
        continue;
      }
      grid.push(pool.splice(random(0, pool.length), 1)[0]);
    }
  }
  return grid;
}

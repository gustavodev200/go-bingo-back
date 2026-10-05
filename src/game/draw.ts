import { MAX_NUMBER } from '../contracts';
import type { RandomInt } from '../core/random';

export function pickNextNumber(
  drawn: ReadonlySet<number>,
  random: RandomInt,
): number | null {
  const remaining: number[] = [];
  for (let n = 1; n <= MAX_NUMBER; n++) if (!drawn.has(n)) remaining.push(n);
  return remaining.length === 0 ? null : remaining[random(0, remaining.length)];
}

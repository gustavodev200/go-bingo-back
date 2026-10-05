import { cryptoRandomInt } from '../core/random';
import { pickNextNumber } from './draw';

describe('pickNextNumber', () => {
  it('never repeats and covers 1–75 then returns null', () => {
    const drawn = new Set<number>();
    for (let i = 0; i < 75; i++) {
      const n = pickNextNumber(drawn, cryptoRandomInt);
      expect(n).not.toBeNull();
      expect(drawn.has(n!)).toBe(false);
      drawn.add(n!);
    }
    expect([...drawn].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 75 }, (_, i) => i + 1),
    );
    expect(pickNextNumber(drawn, cryptoRandomInt)).toBeNull();
  });

  it('picks from the remaining numbers using the random index', () => {
    expect(pickNextNumber(new Set([1, 2]), () => 0)).toBe(3);
  });
});

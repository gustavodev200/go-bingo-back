import { firstFreeSlot } from './slots';

describe('firstFreeSlot', () => {
  it('returns the lowest free slot', () => {
    expect(firstFreeSlot(new Set([0, 1, 3]), 10)).toBe(2);
  });

  it('returns null when the room is full', () => {
    expect(firstFreeSlot(new Set([0, 1]), 2)).toBeNull();
  });
});

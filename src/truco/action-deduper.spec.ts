import { ActionDeduper } from './action-deduper';

describe('ActionDeduper', () => {
  it('runs an action once per (user, actionId) and replays its result', () => {
    const d = new ActionDeduper<number>();
    const fn = jest.fn(() => 42);
    expect(d.run('u1', 'a1', fn)).toBe(42);
    expect(d.run('u1', 'a1', fn)).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
    d.run('u2', 'a1', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('forgets the oldest entries past its capacity', () => {
    const d = new ActionDeduper<number>(2);
    let n = 0;
    const fn = () => ++n;
    d.run('u', 'a', fn);
    d.run('u', 'b', fn);
    d.run('u', 'c', fn);
    expect(d.run('u', 'a', fn)).toBe(4);
    expect(d.run('u', 'c', fn)).toBe(3);
  });
});

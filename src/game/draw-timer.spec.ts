import { realDrawTimer } from './draw-timer';

describe('realDrawTimer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('set() schedules the callback after the given delay', () => {
    const fn = jest.fn();
    realDrawTimer.set(fn, 1_000);
    jest.advanceTimersByTime(999);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clear() cancels a scheduled callback before it fires', () => {
    const fn = jest.fn();
    const handle = realDrawTimer.set(fn, 1_000);
    realDrawTimer.clear(handle);
    jest.advanceTimersByTime(5_000);
    expect(fn).not.toHaveBeenCalled();
  });
});

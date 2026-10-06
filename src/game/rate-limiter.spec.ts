import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('allows up to the limit inside the window and recovers after it', () => {
    let now = 1_000;
    const limiter = new RateLimiter(() => now);
    for (let i = 0; i < 10; i++)
      expect(limiter.allow('s1', 10, 1_000)).toBe(true);
    expect(limiter.allow('s1', 10, 1_000)).toBe(false);
    now += 1_001;
    expect(limiter.allow('s1', 10, 1_000)).toBe(true);
  });

  it('keeps keys independent and forgets by prefix', () => {
    const limiter = new RateLimiter(() => 0);
    expect(limiter.allow('s1:claim', 1, 2_000)).toBe(true);
    expect(limiter.allow('s1:claim', 1, 2_000)).toBe(false);
    expect(limiter.allow('s2:claim', 1, 2_000)).toBe(true);
    limiter.forget('s1');
    expect(limiter.allow('s1:claim', 1, 2_000)).toBe(true);
  });

  it('defaults to Date.now when no clock is injected', () => {
    const limiter = new RateLimiter();
    expect(limiter.allow('default-clock', 1, 60_000)).toBe(true);
    expect(limiter.allow('default-clock', 1, 60_000)).toBe(false);
  });
});

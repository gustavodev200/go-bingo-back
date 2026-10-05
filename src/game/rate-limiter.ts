export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  allow(key: string, limit: number, windowMs: number): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => t - at < windowMs);
    const allowed = recent.length < limit;
    if (allowed) recent.push(t);
    this.hits.set(key, recent);
    return allowed;
  }

  forget(prefix: string): void {
    for (const key of this.hits.keys())
      if (key.startsWith(prefix)) this.hits.delete(key);
  }
}

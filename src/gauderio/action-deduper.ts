/**
 * Remembers the result of recent game actions by (user, actionId). A client
 * retrying an action (lost ack, double tap, reconnection replay) gets the
 * original answer back instead of running the move twice.
 */
export class ActionDeduper<R> {
  private readonly results = new Map<string, R>();

  constructor(private readonly capacity = 5_000) {}

  run(userId: string, actionId: string, fn: () => R): R {
    const key = `${userId}:${actionId}`;
    if (this.results.has(key)) return this.results.get(key)!;
    const result = fn();
    this.results.set(key, result);
    // Map keeps insertion order: drop the oldest entries past the capacity.
    for (const oldest of this.results.keys()) {
      if (this.results.size <= this.capacity) break;
      this.results.delete(oldest);
    }
    return result;
  }
}

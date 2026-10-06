import type { ExecutionContext } from '@nestjs/common';
import { HttpThrottlerGuard } from './http-throttler.guard';

function makeContext(type: string): ExecutionContext {
  return { getType: () => type } as unknown as ExecutionContext;
}

describe('HttpThrottlerGuard', () => {
  it('does not skip throttling for HTTP requests', async () => {
    const guard = new HttpThrottlerGuard({} as never, {} as never, {} as never);
    await expect(
      (
        guard as unknown as {
          shouldSkip(ctx: ExecutionContext): Promise<boolean>;
        }
      ).shouldSkip(makeContext('http')),
    ).resolves.toBe(false);
  });

  it('skips throttling for non-HTTP contexts (e.g. websockets)', async () => {
    const guard = new HttpThrottlerGuard({} as never, {} as never, {} as never);
    await expect(
      (
        guard as unknown as {
          shouldSkip(ctx: ExecutionContext): Promise<boolean>;
        }
      ).shouldSkip(makeContext('ws')),
    ).resolves.toBe(true);
  });
});

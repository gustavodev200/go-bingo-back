import type { ExecutionContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestAuth } from '../../../test/support/auth';
import { DomainError } from '../domain-error';
import { AuthedRequest, HttpAuthGuard } from './http-auth.guard';
import { JwtVerifier } from './jwt-verifier';

const SUPABASE_URL = 'https://test.supabase.local';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

function makeContext(headers: Record<string, string>) {
  const req = { headers } as AuthedRequest;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('HttpAuthGuard', () => {
  it('rejects a missing Authorization header', async () => {
    const auth = await createTestAuth(ISSUER);
    const guard = new HttpAuthGuard(
      new JwtVerifier(auth.keySet, { SUPABASE_URL }),
    );
    const { ctx } = makeContext({});

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(DomainError);
  });

  it('rejects a non-Bearer scheme', async () => {
    const auth = await createTestAuth(ISSUER);
    const guard = new HttpAuthGuard(
      new JwtVerifier(auth.keySet, { SUPABASE_URL }),
    );
    const { ctx } = makeContext({ authorization: 'Basic xyz' });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(DomainError);
  });

  it('rejects an empty bearer token', async () => {
    const auth = await createTestAuth(ISSUER);
    const guard = new HttpAuthGuard(
      new JwtVerifier(auth.keySet, { SUPABASE_URL }),
    );
    const { ctx } = makeContext({ authorization: 'Bearer ' });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('sets req.user from the verifier result on a valid token and allows the request', async () => {
    const auth = await createTestAuth(ISSUER);
    const guard = new HttpAuthGuard(
      new JwtVerifier(auth.keySet, { SUPABASE_URL }),
    );
    const id = randomUUID();
    const token = await auth.sign(id, { isAnonymous: true });
    const { ctx, req } = makeContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({ id, isAnonymous: true });
  });
});

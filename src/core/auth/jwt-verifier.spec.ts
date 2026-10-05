import { randomUUID } from 'node:crypto';
import { createTestAuth } from '../../../test/support/auth';
import { DomainError } from '../domain-error';
import { JwtVerifier } from './jwt-verifier';

const SUPABASE_URL = 'https://test.supabase.local';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

describe('JwtVerifier', () => {
  it('returns the user id and anonymous flag', async () => {
    const auth = await createTestAuth(ISSUER);
    const verifier = new JwtVerifier(auth.keySet, { SUPABASE_URL });
    const id = randomUUID();

    await expect(
      verifier.verify(await auth.sign(id, { isAnonymous: true })),
    ).resolves.toEqual({ id, isAnonymous: true });
    await expect(verifier.verify(await auth.sign(id))).resolves.toEqual({
      id,
      isAnonymous: false,
    });
  });

  it('rejects a token from another issuer', async () => {
    const auth = await createTestAuth('https://evil.example/auth/v1');
    const verifier = new JwtVerifier(auth.keySet, { SUPABASE_URL });
    await expect(
      verifier.verify(await auth.sign(randomUUID())),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('rejects an expired token', async () => {
    const auth = await createTestAuth(ISSUER);
    const verifier = new JwtVerifier(auth.keySet, { SUPABASE_URL });
    const token = await auth.sign(randomUUID(), { expiresIn: '-1m' });
    await expect(verifier.verify(token)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects garbage', async () => {
    const auth = await createTestAuth(ISSUER);
    const verifier = new JwtVerifier(auth.keySet, { SUPABASE_URL });
    await expect(verifier.verify('not.a.jwt')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});

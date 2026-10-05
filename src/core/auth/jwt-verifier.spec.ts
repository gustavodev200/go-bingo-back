import { randomUUID } from 'node:crypto';
import { SignJWT, type KeyLike } from 'jose';
import { createTestAuth } from '../../../test/support/auth';
import { DomainError } from '../domain-error';
import { JwtVerifier } from './jwt-verifier';

const SUPABASE_URL = 'https://test.supabase.local';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

/** Assina um JWT "na mão" com a chave privada de `auth`, permitindo alterar
 * exatamente uma claim por vez (sub, aud, …) sem passar pelos valores fixos
 * de `auth.sign`. Usado para isolar cada checagem do verifier. */
function signRaw(
  auth: { privateKey: KeyLike },
  claims: Record<string, unknown>,
  overrides: {
    sub?: string;
    issuer?: string;
    audience?: string;
    expiresIn?: string;
  } = {},
) {
  let jwt = new SignJWT(claims).setProtectedHeader({
    alg: 'ES256',
    kid: 'test-key',
  });
  if (overrides.sub !== undefined) jwt = jwt.setSubject(overrides.sub);
  jwt = jwt
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? '1h');
  return jwt.sign(auth.privateKey);
}

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

  it('rejects a token forged with a different key pair (same issuer and kid)', async () => {
    const auth = await createTestAuth(ISSUER);
    const forger = await createTestAuth(ISSUER);
    const verifier = new JwtVerifier(auth.keySet, { SUPABASE_URL });

    // Same issuer, same kid, perfectly well-formed token — but signed by a
    // key the verifier's JWKS does not trust. Must fail on signature alone.
    const forged = await forger.sign(randomUUID());
    await expect(verifier.verify(forged)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a token with the wrong audience', async () => {
    const auth = await createTestAuth(ISSUER);
    const verifier = new JwtVerifier(auth.keySet, { SUPABASE_URL });

    const token = await signRaw(
      auth,
      { is_anonymous: false },
      { sub: randomUUID(), audience: 'service_role' },
    );
    await expect(verifier.verify(token)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a token with no subject claim', async () => {
    const auth = await createTestAuth(ISSUER);
    const verifier = new JwtVerifier(auth.keySet, { SUPABASE_URL });

    const token = await signRaw(auth, { is_anonymous: false });
    await expect(verifier.verify(token)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('treats a token with no is_anonymous claim as anonymous (fails closed)', async () => {
    const auth = await createTestAuth(ISSUER);
    const verifier = new JwtVerifier(auth.keySet, { SUPABASE_URL });
    const id = randomUUID();

    const token = await signRaw(auth, {}, { sub: id });
    await expect(verifier.verify(token)).resolves.toEqual({
      id,
      isAnonymous: true,
    });
  });
});

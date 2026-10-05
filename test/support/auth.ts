import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

export async function createTestAuth(issuer: string) {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: 'test-key',
    alg: 'ES256',
  };
  const keySet = createLocalJWKSet({ keys: [jwk] });

  async function sign(
    sub: string,
    opts: { isAnonymous?: boolean; expiresIn?: string } = {},
  ) {
    return new SignJWT({
      is_anonymous: opts.isAnonymous ?? false,
      role: 'authenticated',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setSubject(sub)
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '1h')
      .sign(privateKey);
  }

  return { keySet, sign, privateKey };
}

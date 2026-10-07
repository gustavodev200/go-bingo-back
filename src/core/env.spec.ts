import { loadEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DIRECT_URL: 'postgresql://u:p@localhost:5432/db',
  CORS_ORIGIN: 'http://localhost:3000',
  SUPABASE_URL: 'https://abc.supabase.co',
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3333);
    expect(env.NODE_ENV).toBe('development');
    expect(env.TRUST_PROXY).toBe(false);
  });

  it('parses TRUST_PROXY from the literal string, not via truthiness', () => {
    expect(loadEnv({ ...valid, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    // O ponto desse teste: "false" como string não pode virar true (o que
    // z.coerce.boolean() faria, já que Boolean("false") é truthy).
    expect(loadEnv({ ...valid, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
  });

  it('throws when TRUST_PROXY is not a recognizable boolean string', () => {
    expect(() => loadEnv({ ...valid, TRUST_PROXY: 'garbage' })).toThrow(
      /TRUST_PROXY/,
    );
  });

  it('coerces PORT', () => {
    expect(loadEnv({ ...valid, PORT: '0' }).PORT).toBe(0);
  });

  it('throws listing the invalid variable', () => {
    expect(() => loadEnv({ ...valid, SUPABASE_URL: 'not-a-url' })).toThrow(
      /SUPABASE_URL/,
    );
  });

  it('throws when a required variable is missing', () => {
    const { DATABASE_URL, ...withoutDatabaseUrl } = valid;
    void DATABASE_URL;
    expect(() => loadEnv(withoutDatabaseUrl)).toThrow(/DATABASE_URL/);
  });

  it('throws when PORT is not numeric', () => {
    expect(() => loadEnv({ ...valid, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('reads from process.env when no source is given', () => {
    const original = { ...process.env };
    Object.assign(process.env, valid, { PORT: '4321' });
    try {
      expect(loadEnv().PORT).toBe(4321);
    } finally {
      process.env = original;
    }
  });

  it('SENTRY_DSN é opcional e validado como URL', () => {
    expect(loadEnv({ ...valid }).SENTRY_DSN).toBeUndefined();
    expect(
      loadEnv({ ...valid, SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1' })
        .SENTRY_DSN,
    ).toBe('https://k@o1.ingest.sentry.io/1');
    expect(() => loadEnv({ ...valid, SENTRY_DSN: 'nao-e-url' })).toThrow();
  });

  it('string vazia em SENTRY_DSN/SENTRY_ENVIRONMENT conta como ausente', () => {
    const env = loadEnv({ ...valid, SENTRY_DSN: '', SENTRY_ENVIRONMENT: '' });
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.SENTRY_ENVIRONMENT).toBeUndefined();
  });
});

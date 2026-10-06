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
});

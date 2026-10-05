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
});

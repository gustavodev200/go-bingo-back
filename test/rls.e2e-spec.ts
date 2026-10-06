import { createTestApp, type TestApp } from './support/app';

describe('RLS (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('toda tabela do schema public tem RLS ligada', async () => {
    const rows = await t.prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});

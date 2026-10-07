// ATENÇÃO: esta suíte cria um schema `auth` FALSO (users/sessions) e o remove no
// fim. Só rode contra Postgres local/CI. Se `auth.users` já existir (ex.: um
// Supabase real com GoTrue), a suíte aborta sem tocar em nada; e o teardown só
// derruba o schema se ESTA execução o criou (nunca faz limpeza "por garantia").
import { createTestApp, type TestApp } from './support/app';
import { GuestCleanupService } from '../src/guests/guest-cleanup.service';

const OLD = "now() - interval '40 days'";
const ids = {
  stale: '00000000-0000-4000-8000-000000000001',
  activeSession: '00000000-0000-4000-8000-000000000002',
  upgraded: '00000000-0000-4000-8000-000000000003',
  updatedRecently: '00000000-0000-4000-8000-000000000004',
};

describe('GuestCleanupService (e2e)', () => {
  let t: TestApp;
  let createdAuth = false;
  beforeAll(async () => {
    t = await createTestApp();
    const [{ exists }] = await t.prisma.$queryRaw<
      { exists: boolean }[]
    >`SELECT to_regclass('auth.users') IS NOT NULL AS exists`;
    if (exists) {
      throw new Error(
        'auth.users já existe: esta suíte usa um schema auth falso e só deve rodar em Postgres local/CI (nunca em Supabase real).',
      );
    }
    await t.prisma.$executeRawUnsafe(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, is_anonymous boolean, last_sign_in_at timestamptz, created_at timestamptz DEFAULT now());
      CREATE TABLE auth.sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz, refreshed_at timestamp);`);
    createdAuth = true;
  });
  afterAll(async () => {
    if (createdAuth) {
      await t.prisma.$executeRawUnsafe('DROP SCHEMA auth CASCADE');
    }
    if (t) await t.app.close();
  });

  it('apaga só convidado antigo e sem sessão recente', async () => {
    await t.resetDb();
    await t.prisma.$executeRawUnsafe(`
      INSERT INTO auth.users (id, is_anonymous, last_sign_in_at) VALUES
        ('${ids.stale}', true, ${OLD}), ('${ids.activeSession}', true, ${OLD}), ('${ids.upgraded}', false, ${OLD});
      INSERT INTO auth.sessions (user_id, refreshed_at) VALUES ('${ids.activeSession}', now());`);
    await t.prisma.profile.createMany({
      data: [
        { id: ids.stale, isGuest: true },
        { id: ids.activeSession, isGuest: true },
        { id: ids.upgraded, isGuest: false },
      ],
    });

    const result = await t.app.get(GuestCleanupService).cleanup();

    expect(result).toEqual({ authUsers: 1, profiles: 1 });
    const left = await t.prisma.profile.findMany({ select: { id: true } });
    expect(left.map((p) => p.id).sort()).toEqual([
      ids.activeSession,
      ids.upgraded,
    ]);
  });

  it('sessÃ£o com refreshed_at antigo mas updated_at recente conta como ativa', async () => {
    await t.resetDb();
    await t.prisma.$executeRawUnsafe(`
      INSERT INTO auth.users (id, is_anonymous, last_sign_in_at) VALUES ('${ids.updatedRecently}', true, ${OLD});
      INSERT INTO auth.sessions (user_id, refreshed_at, updated_at) VALUES ('${ids.updatedRecently}', ${OLD}, now());`);
    await t.prisma.profile.create({
      data: { id: ids.updatedRecently, isGuest: true },
    });

    const result = await t.app.get(GuestCleanupService).cleanup();

    expect(result).toEqual({ authUsers: 0, profiles: 0 });
    expect(await t.prisma.profile.count()).toBe(1);
  });
});

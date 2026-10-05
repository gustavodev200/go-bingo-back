---
name: supabase
description: Use ao trabalhar com Supabase (client, Auth, Storage, Edge Functions, migrations SQL). Aplica-se apenas quando project.config.json tiver preset "supabase" (ou database "supabase"). NÃO usar em projetos com preset "prisma-postgres" — nesse caso ver a skill prisma.
---

# Supabase

Confirme `project.config.json` antes de aplicar esta skill (ver
`core/stack-detection`) — ela não se aplica a projetos Prisma/PostgreSQL.

## Regra central: RLS não é opcional

**Toda tabela acessada via `supabase-js`/PostgREST a partir do client tem
Row Level Security habilitada, com policy explícita.** Sem policy, a tabela
fica bloqueada por padrão (correto) — nunca abra com `USING (true)` "para
funcionar" sem entender a implicação. Detalhe completo em
`.claude/skills/security/references/supabase-rls.md` — leia antes de criar
ou alterar qualquer tabela.

## Clients

- Client anônimo (`anon key`) só no browser/Server Component para leitura
  já protegida por RLS.
- Client com `service role key` **nunca** no browser — só em Server
  Actions/Route Handlers/Edge Functions, para operações que legitimamente
  precisam bypassar RLS (ex.: job administrativo). Toda vez que usar a
  service role, justifique no `plan.md` da feature.

## Auth

- Se `project.config.json` declara `auth: "supabase-auth"`, use o client de
  auth do Supabase para sessão — não misture com outro provider sem
  documentar o desvio.
- Middleware do Next.js atualiza a sessão do Supabase a cada request
  (padrão oficial `@supabase/ssr`) — não implemente refresh de token manual.

## Storage

- Buckets privados por padrão; bucket público só para asset que é
  realmente público (ex.: avatar). Policy de Storage segue o mesmo
  princípio de RLS: acesso explícito, nunca aberto por padrão.
- Valide tipo e tamanho de arquivo antes do upload (ver skill `security`,
  upload de arquivos) — RLS de Storage não substitui essa validação.

## Migrations

- Mudança de schema via arquivo SQL versionado em `supabase/migrations/`
  (`supabase migration new <nome>`) — nunca editar tabela direto pelo
  Studio em produção sem depois refletir a mudança numa migration.
- Toda migration que cria tabela nova inclui, no mesmo arquivo, o `ALTER
  TABLE ... ENABLE ROW LEVEL SECURITY` e as policies — RLS nunca é "depois".

## Edge Functions

- Use para lógica que precisa rodar com privilégio elevado perto do banco,
  ou para webhooks de terceiros — validam entrada com Zod (Deno suporta)
  como qualquer outra borda.

## YAGNI

Não replique lógica de autorização já coberta por uma RLS policy dentro da
aplicação "por garantia" de forma duplicada e desalinhada — mantenha a
policy como fonte única da regra de acesso a dado.

# Template: Supabase (Preset B)

Scaffold de referência para o Preset B (Next.js + Supabase). Não é uma
aplicação pronta — use como checklist de setup.

## Setup

```bash
npx supabase init
npx supabase start   # ambiente local
npm install @supabase/supabase-js @supabase/ssr zod
```

## Estrutura sugerida

```
supabase/
  migrations/          # SQL versionado, cada migration com RLS incluída
src/
  lib/
    supabase/
      client.ts        # client anon (browser/Server Component)
      server.ts        # client server-side (@supabase/ssr)
      admin.ts          # client com service role — só server, uso excepcional
```

## Arquivos deste template

- `rls-policies.sql.example` — padrão de migration com tabela + RLS +
  policies, para copiar como ponto de partida.
- `.env.example` — URL e keys do projeto Supabase.

## Skills relacionadas

`supabase`, `database/postgresql`, `security` (referência obrigatória:
`security/references/supabase-rls.md`).

## Lembrete

RLS é obrigatória em toda tabela nova — nunca crie uma migration de tabela
sem incluir `ENABLE ROW LEVEL SECURITY` e as policies na mesma migration
(ver `rls-policies.sql.example`).

---
name: better-auth
description: Use ao implementar autenticação com Better Auth. Aplica-se por padrão ao preset "prisma-postgres" deste workspace; só use num projeto "supabase" se project.config.json declarar explicitamente auth "better-auth" (desvio pontual documentado no plan.md).
---

# Better Auth

Better Auth é o provedor de autenticação padrão do preset
Prisma/PostgreSQL. Verifique `project.config.json` → campo `auth` antes de
assumir que está em uso (ver skill `core/stack-detection`).

## Setup

- Better Auth usa seu próprio schema de tabelas (user, session, account,
  verification) — gerencie essas tabelas via migration do Prisma
  (`prisma migrate`), nunca editando o schema manualmente fora do fluxo de
  migration.
- Configuração central em um único arquivo (`lib/auth.ts` ou equivalente) —
  não espalhe configuração de provider/sessão por múltiplos arquivos.

## Sessão

- Valide sessão no server (Server Component, Server Action, Route Handler)
  via o helper de sessão do Better Auth — nunca confie em estado de sessão
  guardado só no client.
- Middleware do Next.js pode fazer checagem leve (usuário logado ou não)
  para redirecionamento, mas a checagem de autorização fina (ownership,
  role) acontece na rota/Server Action, não só no middleware.

## Segurança

- Rate limit em login, signup e reset de senha (ver skill `security`,
  seção API/rate limiting).
- Cookies de sessão `httpOnly`, `secure` em produção, `sameSite` apropriado
  — configuração padrão do Better Auth já cobre isso; não enfraqueça.
- Nunca logar token de sessão, senha ou código de verificação.

## RBAC

- Se o projeto precisa de papéis (admin, member, etc.), modele via plugin
  de organização/roles do Better Auth ou campo `role` na tabela de usuário
  — decida na fase Plan e documente no `plan.md`, não improvise por
  feature.

## YAGNI

Não implemente múltiplos providers OAuth "para o futuro" — adicione apenas
os que a spec da feature pede.

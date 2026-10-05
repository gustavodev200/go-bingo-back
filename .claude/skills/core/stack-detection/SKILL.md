---
name: stack-detection
description: Use SEMPRE antes de qualquer tarefa de código neste workspace ou em projetos gerados a partir dele — lê project.config.json e determina quais skills condicionais (prisma, supabase, nestjs, etc.) são elegíveis. É o primeiro passo de qualquer /spec, /plan, /tasks, /implement, /test, /security ou /review.
---

# Stack Detection

Determina qual preset tecnológico o projeto atual usa e filtra quais skills
de stack o agente pode carregar. Sem essa checagem, o agente corre o risco
de aplicar regras de Prisma num projeto Supabase (ou vice-versa).

## Algoritmo

1. Procure `project.config.json` na raiz do projeto (mesmo diretório do
   `CLAUDE.md` mais próximo, ou raiz do repositório).
2. **Não existe?** Duas possibilidades:
   - Você está no próprio workspace-template (sem projeto concreto ainda)
     → não assuma stack nenhuma, trabalhe apenas em skills/comandos/templates.
   - Você está num projeto que esqueceu de configurar → avise o usuário e
     ofereça copiar `project.config.example.json` (Prisma/PostgreSQL) ou
     `project.config.supabase.example.json` (Supabase) da raiz do workspace.
3. **Existe?** Leia o campo `preset` (e os campos individuais `frontend`,
   `backend`, `database`, `auth`, `email`, `storage` para desvios pontuais).
4. Use a tabela abaixo para saber quais skills carregar.

## Tabela preset → skills elegíveis

| preset | Sempre elegíveis (preset-agnósticas) | Elegíveis condicionalmente | Nunca carregar |
|---|---|---|---|
| `prisma-postgres` | `frontend/*`, `database/postgresql`, `security/*`, `testing`, `performance`, `code-review`, `core/*` | `backend/nestjs`, `prisma` | `supabase` |
| `supabase` | `frontend/*`, `database/postgresql`, `security/*`, `testing`, `performance`, `code-review`, `core/*` | `supabase` | `backend/nestjs`, `prisma` |

Regra geral: uma skill de domínio de stack (não preset-agnóstica) só é
elegível se seu nome aparecer explicitamente na linha do preset ativo. Na
dúvida, releia a `description` do `SKILL.md` da skill candidata — toda skill
stack-specific declara sua condição de preset no próprio frontmatter.

## Desvios pontuais

Um `project.config.json` pode ter `preset: "supabase"` mas `auth:
"better-auth"` (projeto usa Supabase só para dados, com Better Auth por
cima). Nesse caso:

- Carregue a skill `frontend/better-auth` normalmente (é preset-agnóstica).
- Não carregue `supabase` inteira assumindo Supabase Auth — verifique o
  campo `auth` explicitamente antes de aplicar regras de Supabase Auth.
- Registre o desvio como decisão consciente no `plan.md` da feature (fase
  Plan do SpecKit), não em silêncio.

## Adicionando um preset novo

Ver `CONTRIBUTING.md#adicionando-uma-nova-stack` no root do workspace. Ao
adicionar, sempre atualize a tabela acima.

---
name: prisma
description: Use ao trabalhar com Prisma ORM (schema.prisma, migrations, Prisma Client). Aplica-se apenas quando project.config.json tiver preset "prisma-postgres" (ou database "prisma-postgres"). NÃO usar em projetos com preset "supabase" — nesse caso ver a skill supabase.
---

# Prisma

Confirme `project.config.json` antes de aplicar esta skill (ver
`core/stack-detection`) — ela não se aplica a projetos Supabase.

## Schema

- `schema.prisma` é a fonte única de verdade do modelo de dados — não crie
  tipos TypeScript de entidade paralelos e desalinhados; use os tipos
  gerados pelo Prisma Client.
- Relações explícitas com `@relation`, incluindo `onDelete`/`onUpdate`
  deliberados (não deixe no padrão implícito sem pensar no efeito).
- `@@index` em toda foreign key e em colunas de filtro/ordenação frequente
  (ver skill `database/postgresql`).

## Migrations

- `prisma migrate dev` em desenvolvimento, `prisma migrate deploy` em
  CI/produção — nunca `prisma db push` em produção (não gera histórico de
  migration).
- Revise o SQL gerado pela migration antes de aplicar em produção quando ela
  envolver alteração de coluna existente (rename, mudança de tipo, drop).
- Migration destrutiva (drop column/table) exige confirmação explícita do
  usuário antes de rodar contra banco com dado real — nunca execute
  automaticamente.

## Prisma Client

- Uma instância singleton do `PrismaClient` por processo (evite
  `new PrismaClient()` espalhado — esgota connections). No NestJS, isso é o
  `PrismaService` injetável.
- Use `select`/`include` explícitos em vez de trazer o objeto inteiro
  quando só parte dos campos é necessária (evita expor campo sensível por
  acidente — ver skill `security`, exposição de dados).
- Transações (`prisma.$transaction`) para operações que precisam ser
  atômicas (ex.: debitar saldo + criar registro de transação).

## Segurança

- Nunca use `$queryRawUnsafe` com valor de usuário interpolado — se
  precisar de SQL raw, use `$queryRaw` com template tag parametrizado.
- Autorização (ownership/RBAC) é responsabilidade do service (NestJS), não
  do Prisma — o Prisma não tem RLS; toda checagem de "quem pode ver isto"
  é código explícito. Ver skill `security`.

## YAGNI

Não adicione middleware customizado do Prisma Client, soft-delete global ou
multi-tenancy via schema a menos que a spec da feature realmente exija.

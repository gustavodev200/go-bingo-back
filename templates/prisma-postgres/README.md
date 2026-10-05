# Template: Prisma + PostgreSQL (Preset A)

Scaffold de referência para o backend do Preset A (Next.js + NestJS +
Prisma + PostgreSQL). Não é uma aplicação pronta — use como checklist de
setup e ponto de partida para o `schema.prisma`.

## Setup

```bash
npx @nestjs/cli new api
cd api
npm install @prisma/client zod
npm install -D prisma
npx prisma init --datasource-provider postgresql
```

## Estrutura sugerida (NestJS)

```
src/
  prisma/
    prisma.service.ts   # PrismaClient singleton injetável
  users/
    users.module.ts
    users.controller.ts
    users.service.ts
    dto/
      create-user.schema.ts   # Zod schema
```

## Arquivos deste template

- `schema.prisma.example` — modelo mínimo (User + tabelas do Better Auth)
  como ponto de partida.
- `.env.example` — `DATABASE_URL` e variáveis do Better Auth.

## Skills relacionadas

`backend/nestjs`, `prisma`, `database/postgresql`, `frontend/better-auth`,
`security` (autorização/IDOR fica no service, não há RLS neste preset).

# Wiring — Preset A: Next.js + NestJS + Prisma + PostgreSQL

Guia de como as peças se conectam. Não é um passo a passo de instalação
(isso está em `templates/nextjs/README.md` e
`templates/prisma-postgres/README.md`) — é o mapa de como os dois serviços
conversam.

## Topologia

```
Next.js (frontend)  --HTTP-->  NestJS (backend)  --Prisma Client-->  PostgreSQL
      |                              |
   Better Auth                   valida sessão
   (sessão própria                (verifica token/cookie
    ou via NestJS)                 vindo do Next.js)
```

## Onde a sessão vive

Duas opções válidas — decida na fase `/speckit-plan` e documente:

1. **Better Auth no próprio Next.js**, NestJS confia num token assinado
   compartilhado (ex.: JWT validado pelo NestJS com a mesma chave). Mais
   simples quando o backend é consumido só pelo próprio frontend.
2. **Better Auth serve como gateway de auth**, NestJS valida a sessão
   chamando um endpoint interno do Next.js ou compartilhando o banco de
   sessão. Faz mais sentido se houver outros clientes (mobile) consumindo
   o NestJS diretamente.

## Fluxo de uma mutação típica

1. Formulário shadcn/ui no Next.js valida com Zod (`zodResolver`).
2. Server Action ou client faz request para o NestJS.
3. NestJS valida o mesmo schema Zod (ou um DTO equivalente) na borda.
4. Guard confirma sessão; service confirma autorização (ownership/RBAC).
5. Service usa `PrismaService` para persistir.
6. Resposta tipada volta ao Next.js.

## Onde cada skill entra

`frontend/nextjs`, `frontend/zod`, `frontend/shadcn-ui`, `frontend/better-
auth` no Next.js; `backend/nestjs`, `prisma`, `database/postgresql` no
NestJS; `security` (auth-authz, injection, api-security) nos dois lados.

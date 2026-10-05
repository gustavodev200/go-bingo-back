---
name: nestjs
description: Use ao construir o backend com NestJS. Aplica-se apenas quando project.config.json tiver preset "prisma-postgres" (ou backend "nestjs" explícito). Não usar em projetos com preset "supabase" — nesse caso a lógica de backend vai em Server Actions/Route Handlers/Edge Functions.
---

# NestJS

Backend padrão do preset Prisma/PostgreSQL. Confirme `project.config.json`
antes de aplicar (ver skill `core/stack-detection`).

## Organização por módulo

- Um módulo NestJS por domínio de negócio (`UsersModule`, `BillingModule`),
  cada um com `controller` (ou resolver, se GraphQL), `service` e `dto/`.
- `service` contém a lógica de negócio e é a única camada que fala com o
  Prisma Client — controller nunca importa `PrismaClient` diretamente.

## Validação

- DTOs de entrada validados com Zod (ver skill `frontend/zod` — mesma regra
  vale no backend) via pipe de validação, aplicado antes do handler rodar.

## Autenticação e autorização

- Guard de autenticação (`AuthGuard`) verifica sessão/token antes de
  qualquer handler protegido.
- Autorização fina (ownership, RBAC) acontece no `service`, não só no
  guard — o guard sabe "quem", o service decide "pode fazer isso nisto".
  Ver skill `security` para checklist de IDOR/RBAC.

## Erros

- Exceptions de domínio usam as exceptions built-in do Nest
  (`NotFoundException`, `ForbiddenException`, etc.) mapeadas para o status
  HTTP correto — nunca vazar stack trace ou mensagem de erro do Prisma
  direto pro client.

## Injeção de dependência

- Use o container de DI do Nest para o Prisma Client (um `PrismaService`
  injetável), Resend, e qualquer client externo — não instancie clients
  manualmente dentro de um service.

## YAGNI

Não introduza GraphQL, microservices (`@nestjs/microservices`) ou CQRS a
menos que a spec da feature realmente exija — REST + módulos simples é o
padrão default.

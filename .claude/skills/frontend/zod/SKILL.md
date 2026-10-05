---
name: zod
description: Use ao validar qualquer entrada externa (formulário, API, webhook, query param) em frontend ou backend — Zod é obrigatório na borda em ambos os presets deste workspace.
---

# Zod

Zod é a ferramenta obrigatória de validação de borda neste workspace, tanto
no preset Prisma/PostgreSQL (NestJS) quanto no preset Supabase (Server
Actions/Route Handlers Next.js).

## Regra central

**Toda entrada externa é validada com Zod antes de tocar lógica de
negócio.** Isso inclui: body de request, query params, form data, payload
de webhook, resposta de API de terceiro que você não controla.

## Padrão de uso

- Defina o schema perto do ponto de entrada (ex.:
  `app/api/users/route.ts` ou `src/users/dto/create-user.schema.ts` no
  NestJS), não centralizado num arquivo gigante de schemas desacoplado do
  uso.
- Derive o tipo TypeScript do schema (`z.infer<typeof schema>`) em vez de
  manter type e schema separados manualmente.
- Em formulários shadcn/ui, o mesmo schema alimenta `zodResolver` no client
  E a validação no server (Server Action) — não duplique regras.
- Erros de validação retornam mensagem clara ao usuário (client) e nunca
  vazam stack trace ou detalhe interno (ver skill `security`).

## NestJS (preset Prisma/PostgreSQL)

- Use um `ZodValidationPipe` (ou `nestjs-zod`) no lugar de `class-validator`
  quando o projeto padronizar em Zod, para manter schema único
  frontend/backend via pacote compartilhado, se o monorepo permitir.

## Supabase (preset Supabase)

- Valide com Zod antes de qualquer chamada ao client Supabase — o Zod não
  substitui RLS, é a primeira camada; RLS é a segunda (defesa em
  profundidade, ver `security/references/supabase-rls.md`).

## YAGNI

Não crie schema Zod para dados que nunca cruzam uma borda (ex.: estado
interno de componente que não vem de fora).

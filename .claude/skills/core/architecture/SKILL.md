---
name: architecture
description: Use ao desenhar a arquitetura de uma feature ou projeto novo (fase Plan do SpecKit) — princípios de organização de código, camadas e limites entre frontend/backend/database válidos para os dois presets deste workspace. Preset-agnóstica.
---

# Arquitetura

Princípios de arquitetura que se aplicam independente do preset
(Prisma/PostgreSQL ou Supabase). Use durante a fase **Plan** do SpecKit,
depois que a spec e o clarify já definiram o "o quê", para decidir o "como".

## Camadas e limites

- **UI (Next.js/React)**: só renderiza e captura interação. Nunca contém
  lógica de autorização ou acesso direto a segredos.
- **Borda de validação**: todo dado que entra (form, API route, Server
  Action, webhook) passa por um schema Zod antes de qualquer outra coisa.
  Ver skill `frontend/zod`.
- **Lógica de negócio**:
  - Preset Prisma/PostgreSQL: vive no backend NestJS (services), nunca em
    Server Actions do Next.js além de orquestração simples.
  - Preset Supabase: vive em Server Actions/Route Handlers do Next.js ou em
    Edge Functions do Supabase quando precisa rodar com privilégio elevado
    (service role) — nunca no client.
- **Acesso a dados**: sempre via camada única (Prisma Client no backend, ou
  cliente Supabase tipado) — nunca query solta duplicada em múltiplos
  lugares.

## Decisões que toda feature de porte médio+ deve registrar no `plan.md`

1. Onde a lógica de autorização é verificada (ver skill `security`).
2. Qual camada valida a entrada (deve ser sempre a borda, com Zod).
3. Se a feature introduz nova tabela: quem pode ler/escrever (RBAC ou RLS,
   conforme preset).
4. Se a feature integra serviço externo (Resend, storage): onde a chamada
   acontece (sempre server-side, nunca client).

## Sinais de que a arquitetura da feature precisa de revisão

- Lógica de negócio duplicada entre frontend e backend.
- Server Action ou Route Handler que faz mutação sem passar por Zod.
- Componente React chamando banco de dados diretamente (Prisma Client ou
  Supabase client) fora de Server Component/Server Action.
- Tabela nova sem RLS (Supabase) ou sem checagem de ownership (Prisma).

## YAGNI

Não introduza camada extra (ex.: repository pattern sobre o Prisma Client,
CQRS, event bus) a menos que a spec da feature realmente exija — justifique
no `plan.md` por que a complexidade adicional é necessária.

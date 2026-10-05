---
name: nextjs
description: Use ao criar ou modificar páginas, layouts, Server Actions, Route Handlers ou componentes em projetos Next.js — convenções deste workspace para o App Router. Preset-agnóstica (usada tanto no preset Prisma/PostgreSQL quanto no Supabase).
---

# Next.js

Convenções para projetos Next.js (App Router) neste workspace, válidas para
os dois presets.

## Server vs Client Components

- Padrão: Server Component. Só marque `"use client"` quando precisar de
  estado, efeito ou interação do browser (ex.: formulário controlado, hook
  do Zustand).
- Nunca faça fetch de dados sensíveis num Client Component — busque no
  Server Component/Server Action e passe como prop.

## Mutações

- Prefira Server Actions para mutações simples ligadas a um formulário.
- Use Route Handler (`app/api/**/route.ts`) quando o consumidor for externo
  (webhook, API pública, integração de terceiros) ou quando precisar de
  controle fino sobre método HTTP/headers.
- Toda Server Action e Route Handler que recebe input do usuário valida com
  Zod antes de qualquer lógica (ver skill `frontend/zod`).

## Autorização em rota

- Cheque sessão/autorização no topo do Server Component, Server Action ou
  Route Handler — nunca confie em esconder um link/botão no client como
  única proteção. Ver skill `security` para checklist de authz/IDOR.

## Erros e loading

- Use `error.tsx` e `loading.tsx` por rota em vez de estado manual de
  loading/erro espalhado pelos componentes, quando o padrão do App Router
  cobrir o caso.

## Variáveis de ambiente

- Nunca exponha uma env var sensível com prefixo `NEXT_PUBLIC_`. Esse
  prefixo é só para valores realmente públicos (ex.: URL pública da API).

## YAGNI

Não introduza `middleware.ts` complexo, i18n, ou App Router route groups
avançados a menos que a spec da feature exija.

---
name: performance
description: Use ao investigar ou prevenir problema de performance (query lenta, re-render excessivo, payload grande) em Next.js, NestJS, Prisma ou Supabase. Preset-agnóstica.
---

# Performance

## Banco de dados

- **N+1**: ao buscar lista com relação (ex.: posts + autor), use `include`
  (Prisma) ou `select` com join (Supabase/PostgREST) numa query só, nunca
  um loop fazendo uma query por item.
- Índice em coluna de filtro/ordenação frequente (ver skill
  `database/postgresql`) — meça antes de assumir que falta índice
  (`EXPLAIN ANALYZE`).
- Paginação (`cursor` ou `offset` com limite) em toda listagem que pode
  crescer — nunca trazer tabela inteira para paginar no client.

## Backend (NestJS) / Server (Next.js)

- Cache de resultado caro e pouco mutável (ex.: config, lista de
  categorias) com TTL curto, em vez de recalcular/reconsultar a cada
  request — só adicione cache quando houver evidência de custo real.
- Chamada a serviço externo (Resend, storage) fora do caminho crítico de
  resposta ao usuário quando possível (ex.: disparar email depois de
  responder, não bloquear a resposta principal nele).

## Frontend (Next.js/React)

- Evite re-render desnecessário: prop/objeto novo a cada render vira nova
  referência — memoize (`useMemo`/`useCallback`) quando o componente filho
  é caro ou usa `React.memo`.
- Prefira Server Components para dado que não precisa de interatividade —
  reduz JS enviado ao client.
- Imagens via `next/image` (otimização automática) em vez de `<img>` cru
  para asset de conteúdo.
- Zustand: selectors específicos (ver skill `frontend/zustand`) evitam
  re-render de componente que não usa o slice de estado alterado.

## Como investigar (antes de otimizar às cegas)

1. Meça primeiro (`EXPLAIN ANALYZE` no banco, profiler do browser/React
   DevTools, tempo de resposta real) — não otimize por suposição.
2. Otimize o gargalo medido, não o que "parece" lento.
3. Re-meça para confirmar ganho real.

## YAGNI

Não introduza CDN, cache distribuído (Redis) ou read replica antes de ter
evidência de que o gargalo é esse e que a solução simples (índice,
paginação, memoização) não resolve.

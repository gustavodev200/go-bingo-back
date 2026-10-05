---
name: zustand
description: Use ao gerenciar estado global no client (Next.js) — quando usar Zustand vs estado local/Server Component neste workspace. Preset-agnóstica.
---

# Zustand

## Quando usar

Zustand é para estado de **client** compartilhado entre componentes que não
tem correspondência direta no servidor (ex.: estado de UI complexo, carrinho
antes de checkout, filtros de uma tabela interativa).

Não use Zustand para:

- Dados que vêm do servidor e podem ser buscados via Server
  Component/React Query-like pattern — isso é estado de servidor, não de
  client.
- Estado que só um componente e seus filhos diretos usam — use
  `useState`/`useReducer` local ou prop drilling raso.
- Sessão de autenticação — isso vem do provider de auth (Better Auth ou
  Supabase Auth), não de uma store Zustand paralela.

## Padrão de store

- Uma store por domínio de UI (`useCartStore`, `useFilterStore`), não uma
  store global única com tudo.
- Store fica em `lib/stores/<nome>.ts`, tipada, sem lógica de fetch de
  dados dentro dela — a store guarda estado, não busca dado.
- Selectors específicos (`useCartStore((s) => s.items)`) em vez de
  desestruturar a store inteira, para evitar re-render desnecessário.

## YAGNI

Não adicione middleware de persistência (`persist`) a menos que o estado
realmente precise sobreviver a reload — nesse caso, prefira o `persist`
oficial do Zustand em vez de `localStorage` manual.

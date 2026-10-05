---
name: testing
description: Use ao escrever testes para uma feature (fase Tests do SpecKit, comando /test) — estratégia de testes deste workspace para Next.js/NestJS/Prisma/Supabase. Preset-agnóstica.
---

# Testing

Estratégia de testes válida para os dois presets. Aplique na fase **Tests**
do SpecKit (`/test`), depois da Implementation.

## Pirâmide

- **Unitário**: lógica pura (validação Zod, funções utilitárias, cálculo de
  negócio) — rápido, sem I/O real.
- **Integração**: service/Server Action + banco real (ou banco de teste
  isolado) — cobre a interação real com Prisma/Supabase, não mockada.
  Regra do workspace: **não mocke o banco em teste de integração** — um
  mock que diverge do schema real esconde bug que só aparece em produção.
- **E2E** (Playwright ou equivalente): fluxo crítico do usuário
  (signup/login, ação principal da feature) — poucos, focados no caminho
  feliz + 1-2 erros críticos, não todo edge case.

## Banco de teste

- Preset Prisma/PostgreSQL: banco Postgres real (container Docker local ou
  serviço de CI), migrations aplicadas antes da suíte, dados resetados
  entre testes (transação revertida ou schema recriado).
- Preset Supabase: instância local do Supabase (`supabase start`) ou
  projeto de teste dedicado — nunca rodar teste de integração contra o
  banco de produção.

## O que testar em toda feature

- [ ] Caminho feliz da regra de negócio principal.
- [ ] Autorização: usuário sem permissão recebe erro apropriado (não
      apenas "funciona para o usuário certo" — teste o caso negativo).
- [ ] Validação Zod rejeita input inválido com mensagem clara.
- [ ] Caso de borda relevante ao domínio (ex.: lista vazia, valor no
      limite, concorrência se a feature for sensível a isso).

## O que não testar

- Não escreva teste para getter/setter trivial ou para código gerado
  (migrations, tipos do Prisma/Supabase).
- Não persiga 100% de cobertura como meta — cubra o que importa
  (regra de negócio, autorização, borda de dado).

## YAGNI

Não configure múltiplos frameworks de teste fazendo a mesma coisa — um
runner unitário/integração (Vitest/Jest) e um E2E (Playwright) bastam.

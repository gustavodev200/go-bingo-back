---
name: shadcn-ui
description: Use ao construir UI com componentes shadcn/ui — convenções de instalação, customização e composição neste workspace. Preset-agnóstica.
---

# shadcn/ui

## Instalação de componentes

- Adicione componentes via CLI (`npx shadcn@latest add <componente>`) em vez
  de copiar código manualmente — mantém os componentes atualizáveis.
- Componentes instalados vivem em `components/ui/` e são considerados código
  do projeto (editável), não uma dependência de node_modules — pode
  customizar direto.

## Composição

- Componentes de domínio (ex.: `UserCard`, `InviteForm`) compõem primitivas
  de `components/ui/` — nunca duplicam markup que já existe como primitiva
  shadcn (ex.: reimplementar um Dialog do zero).
- Formulários usam `Form` do shadcn (wrapper de `react-hook-form`) com
  `zodResolver` — schema Zod é a fonte única de verdade da validação (ver
  skill `frontend/zod`).

## Tema e customização

- Tokens de cor/tema ficam em `globals.css`/`tailwind.config` — não
  hardcode cor diretamente em componente quando já existe token.
- Variantes de componente usam `cva` (class-variance-authority), seguindo o
  padrão que o próprio shadcn já gera.

## Acessibilidade

- Componentes shadcn são baseados em Radix e já cobrem ARIA/foco/teclado por
  padrão — não remova esses atributos ao customizar.

## YAGNI

Não crie um design system paralelo por cima do shadcn. Se um componente não
existe no shadcn, componha a partir das primitivas Radix/shadcn existentes
antes de escrever do zero.

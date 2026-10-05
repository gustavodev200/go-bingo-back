---
name: tailwind
description: Use ao estilizar componentes com Tailwind CSS — convenções de classes, tokens e responsividade deste workspace. Preset-agnóstica.
---

# Tailwind CSS

## Convenções

- Classes utilitárias direto no JSX; extraia para `class-variance-authority`
  (`cva`) só quando o componente tiver variantes reais (não por
  antecipação).
- Use os tokens de tema (`bg-background`, `text-foreground`,
  `border-border`, etc. — definidos junto com shadcn/ui) em vez de cores
  cruas (`bg-gray-100`) sempre que o token equivalente existir.
- Responsividade mobile-first: escreva o estilo base para mobile, adicione
  `sm:`/`md:`/`lg:` para telas maiores.

## Organização

- Evite `@apply` para recriar componentes — isso é papel do shadcn/ui
  (componente reutilizável), não de CSS customizado.
- Classes condicionais usam `cn()` (helper `clsx` + `tailwind-merge`, já
  presente em projetos shadcn) para evitar conflito de classes.

## Dark mode

- Se o projeto suportar dark mode, use a estratégia `class` do Tailwind
  (já configurada por padrão em projetos shadcn) — não `prefers-color-scheme`
  isolado, para permitir toggle manual.

## YAGNI

Não configure plugins Tailwind extras (typography, forms, etc.) a menos que
a feature realmente precise.

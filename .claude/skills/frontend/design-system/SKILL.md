---
name: design-system
description: Use ao estruturar tokens (cor, espaçamento, tipografia, radius) e variantes de componente num projeto Next.js/shadcn/Tailwind novo. Ensina o PROCESSO de montar um design system consistente — não define marca, cor ou fonte, isso é decisão de cada projeto. Preset-agnóstica.
---

# Design System — Processo, Não Marca

Cada projeto tem seu próprio design system (cor, tipografia, tom visual) —
isso nunca vem hardcoded neste workspace. O que esta skill dá é o
**processo** de estruturar esse sistema de forma consistente em cima de
shadcn/ui + Tailwind, para não reinventar a organização a cada projeto.

Se você quer um ponto de partida de marca pronto (fonte X, ícone Y, cor Z),
isso é decisão de produto — registre no `plan.md` da primeira feature de UI
ou numa seção própria do `constitution.md` do projeto, não aqui.

## Onde os tokens vivem

- Cor, radius e fontes-base como CSS variables em `app/globals.css`
  (`--background`, `--primary`, `--radius`, etc.) — é o padrão que o
  `shadcn init` já gera; estenda essas variáveis, não crie um sistema de
  cor paralelo.
- `tailwind.config.ts` referencia essas CSS variables (`hsl(var(--primary))`
  etc.) — nunca hardcode hex direto no config para cor de marca; assim o
  tema muda num lugar só (inclui dark mode de graça).
- Tipografia: escolha da fonte é decisão do projeto (`next/font`), mas o
  **uso** segue a escala padrão do Tailwind (`text-sm`...`text-4xl`) — não
  invente tamanho arbitrário (`text-[19px]`) fora da escala.

## Variantes de componente

- Todo componente com mais de um estado visual (botão primário/secundário/
  destrutivo, badge por status) usa `cva` (`class-variance-authority`),
  seguindo o padrão que o próprio shadcn já gera em `components/ui/button.tsx`
  — seguir esse arquivo como referência de como declarar variantes novas.
- Novo componente de domínio (`PriceTag`, `StatusBadge`) compõe primitivas
  de `components/ui/` via `cva` + `cn()` — não escreve classe Tailwind solta
  duplicando o que uma variante já cobre.

## Ícones e assets

- Padrão do shadcn/ui é `lucide-react` — mantenha, a menos que o projeto
  tenha razão de marca para trocar (registre a troca no `plan.md`, é uma
  decisão visível, não um detalhe).
- Ícone e imagem seguem o mesmo processo de qualquer asset: `next/image`
  para imagem (ver skill `seo/references/performance.md`), sem lib de
  ícone paralela além da escolhida.

## Estados obrigatórios por componente interativo

Todo componente interativo novo (botão, input, item de lista clicável)
implementa, no mínimo: `hover`, `focus` visível (acessibilidade, não
opcional), `disabled`, e — quando aplicável — `loading` e `error`. Isso é
processo, não estética: falta de estado de foco é bug de acessibilidade
(ver skill `seo/references/accessibility.md`).

## Documentando decisões de marca do projeto

Quando o projeto define fonte, paleta e tom (normalmente na primeira
feature de UI), registre em uma seção curta do `plan.md` dessa feature:
fonte escolhida, paleta base (poucas cores semânticas, não uma escala
inteira arbitrária), biblioteca de ícone. Isso vira a referência única do
projeto — não se documenta de novo a cada feature nova, só se referencia.

## YAGNI

Não crie Storybook, biblioteca de componente separada do app, ou pacote
de design tokens publicado à parte "para o futuro" — `components/ui/` +
CSS variables já bastam para um projeto único. Considere isso só se o
design system for compartilhado entre múltiplos apps de verdade.

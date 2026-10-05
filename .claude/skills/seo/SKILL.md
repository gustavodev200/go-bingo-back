---
name: seo
description: Use ao auditar ou melhorar SEO, indexação, visibilidade para agentes de IA (llms.txt, AI/GEO), conteúdo de conversão (FAQ, cases, página de posicionamento) e acessibilidade/performance de páginas públicas. Preset-agnóstica quanto a backend — depende do Next.js do frontend, presente nos dois presets deste workspace. Comando correspondente: /seo.
---

# SEO, AI Visibility e Conversão

Índice do checklist de SEO/GEO/conteúdo deste workspace. Cobre páginas
**públicas** (marketing, landing pages, documentação, FAQ) — não é sobre a
aplicação autenticada.

## Regra central: nunca inventar informação

Todo conteúdo gerado aqui (llms.txt, FAQ, cases, página de posicionamento)
usa **só informação real do projeto**. Se não existir dado real (case de
cliente, métrica, depoimento), crie apenas a estrutura vazia pronta para
receber o conteúdo real depois — nunca preencha com exemplo fictício
apresentado como real.

## Antes de implementar

Analise a estrutura atual do projeto primeiro. Não crie página, arquivo ou
rota que já existe ou que pode ser obtida melhorando algo existente —
YAGNI vale aqui como em qualquer outra skill do workspace.

## Índice de referências

| Arquivo | Cobre |
|---|---|
| `references/llms-txt.md` | `/llms.txt` — representação do projeto para agentes de IA |
| `references/robots-sitemap.md` | `/robots.txt`, sitemap, canonical, `noindex` |
| `references/on-page-seo.md` | title, meta description, headings, Open Graph, alt text, links internos, conteúdo duplicado |
| `references/ai-search-geo.md` | Otimização para busca generativa/IA (AI Search, GEO) |
| `references/content-conversion.md` | FAQ (5 dores reais), página de posicionamento/prova, cases com storytelling, funil de links internos |
| `references/accessibility.md` | WCAG 2.2 completo (POUR, contraste, teclado, foco, formulário, autenticação acessível) |
| `references/performance.md` | Core Web Vitals, responsividade — validação de não-regressão |

## Como aplicar durante `/seo`

1. Mapeie o que já existe (páginas públicas, metadata atual, `robots.txt`/
   `llms.txt` se existirem, FAQ, cases).
2. Carregue as referências relevantes — nem toda alteração precisa de
   todas elas.
3. Implemente, priorizando o que gera maior impacto de descoberta/conversão
   com menor complexidade nova.
4. Valide (indexação, IA, conteúdo, SEO, performance, acessibilidade) antes
   de reportar como concluído — ver `references/accessibility.md` e
   `references/performance.md` para as checklists de não-regressão.
5. Reporte no formato de `.claude/commands/seo.md` (Implementado, Arquivos
   modificados, Rotas criadas, SEO, AI Visibility, Conversão, Performance,
   Pendências, Status por categoria).

## Relação com outras skills

- `frontend/nextjs` — `robots.txt`/`sitemap.ts`/metadata API são convenções
  do App Router; siga essa skill para onde cada arquivo vive.
- `performance` — Core Web Vitals e otimização de bundle/imagem já têm
  checklist próprio; esta skill só reforça "não regredir" ao mexer em SEO.
- `code-review` — mudança de conteúdo público (FAQ, cases, positioning)
  ainda passa pela revisão normal de correção/simplicidade.

# SEO On-Page

Auditoria de página pública individual.

## Checklist por página

- [ ] `<title>` único, descritivo, com a palavra-chave principal perto do
      início (Next.js: `metadata.title`, idealmente via template
      (`title: { template: '%s | Site', default: '...' }`) em vez de
      hardcode repetido por página).
- [ ] `meta description` única por página, resume o conteúdo e convida ao
      clique — sem keyword stuffing.
- [ ] Um único `<h1>` por página, alinhado à intenção da página.
- [ ] Hierarquia de `h2`/`h3` lógica (não pula nível, não usa heading só
      pelo estilo visual — isso é papel do CSS/Tailwind).
- [ ] URL legível e estável (slug descritivo, sem parâmetro desnecessário
      para conteúdo que deveria ter URL própria).
- [ ] Open Graph (`og:title`, `og:description`, `og:image`) e Twitter/X
      Card configurados via `metadata.openGraph`/`metadata.twitter` do
      Next.js — imagem com tamanho correto (1200x630 para OG).
- [ ] `alt` descritivo em toda imagem de conteúdo (não decorativa); imagem
      puramente decorativa usa `alt=""`.
- [ ] Sem conteúdo duplicado entre páginas (duas URLs com o mesmo
      conteúdo sem canonical apontando para uma delas).

## Links internos

- [ ] Âncora descritiva (não "clique aqui") quando o link for para
      conteúdo relevante a SEO.
- [ ] Nenhuma página pública importante fica órfã (sem nenhum link interno
      apontando para ela).
- [ ] Ver `content-conversion.md` para a estrutura de funil de link
      interno (home → funcionalidades → conteúdo/FAQ → cases → preços →
      conversão).

## Princípio

Escreva para pessoas primeiro, otimize para o mecanismo de busca depois —
keyword stuffing e conteúdo artificial prejudicam tanto ranking (mecanismos
modernos penalizam) quanto conversão real.

## Antes de implementar

Rode a auditoria nas páginas públicas existentes antes de criar página
nova — a maior parte do ganho costuma vir de corrigir o que já existe.

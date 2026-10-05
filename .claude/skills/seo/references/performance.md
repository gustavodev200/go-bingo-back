# Performance e Responsividade (validação de não-regressão)

Mudança de SEO/conteúdo não pode piorar performance. Esta referência é a
checklist de validação a rodar depois de qualquer implementação de `/seo`
— para otimização de performance em si (N+1, cache, bundle), ver a skill
`performance`, que já cobre isso a fundo. Para acessibilidade, ver
`accessibility.md`.

## Performance — não regredir

- [ ] Nenhuma biblioteca pesada nova adicionada quando uma solução simples
      já resolve (ex.: não adicionar lib de animação inteira só para o
      hero da landing page).
- [ ] Imagem nova usa `next/image` (otimização automática), não `<img>`
      cru.
- [ ] Fonte nova carregada via `next/font` (evita layout shift e request
      bloqueante extra).
- [ ] JSON-LD/schema adicionado não infla o HTML desnecessariamente
      (só os campos relevantes, não o schema inteiro "por garantia").
- [ ] Core Web Vitals (LCP, CLS, INP) não pioraram após a mudança — meça
      antes/depois em página real, não assuma.

## Responsividade

- [ ] Toda página/componente novo ou alterado funciona em mobile, tablet e
      desktop — prioridade para mobile, é de onde vem a maior parte do
      tráfego de busca/conteúdo.

## Validação final antes de reportar concluído

Não considere a tarefa concluída só porque o arquivo foi criado — confirme:

- Indexação: `robots.txt` funcionando, sitemap funcionando, página pública
  indexável, área privada de fato protegida (por auth, não só por
  `robots.txt`), canonical correto.
- IA: `llms.txt` acessível, informação correta, links funcionando.
- Conteúdo: FAQ com as 5 dores reais, página de posicionamento, cases
  estruturados, CTA funcionando.
- SEO: metadata, headings, schema, Open Graph, links internos, URLs,
  imagens.
- Performance: sem regressão medida.
- Acessibilidade: checklist de `accessibility.md` passou.

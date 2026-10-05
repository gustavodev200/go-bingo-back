# robots.txt, Sitemap, Canonical

## robots.txt

Referência: [documentação do Google sobre robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/intro).

- [ ] Permite rastreamento de páginas públicas: landing pages, conteúdo,
      documentação, FAQ, páginas comerciais.
- [ ] Bloqueia rastreamento de: área administrativa, dashboard privado,
      rota autenticada, rota interna, página temporária, recurso sem
      valor de indexação.
- [ ] Referencia o sitemap (`Sitemap: https://dominio.com/sitemap.xml`).
- [ ] Next.js (App Router): implementado via `app/robots.ts`
      (`MetadataRoute.Robots`), não um `public/robots.txt` estático, a
      menos que o projeto já use o estático e não haja motivo para migrar.

**`robots.txt` não é mecanismo de segurança.** Bloquear uma rota ali não a
protege — ela continua acessível a quem tiver a URL. Proteção real de rota
privada é autenticação/autorização (ver skill `security`,
`references/auth-authz.md`), não `robots.txt`.

## Sitemap

- [ ] `app/sitemap.ts` (`MetadataRoute.Sitemap`) lista só páginas públicas
      indexáveis, com `lastModified` real quando disponível.
- [ ] Página que não deveria ser indexada (ex.: página de resultado de
      busca interna, página de agradecimento pós-conversão) não entra no
      sitemap e usa `noindex` (ver abaixo).
- [ ] Sitemap dinâmico (gerado a partir de conteúdo real — posts, docs) em
      vez de lista hardcoded quando o conteúdo já vem de uma fonte de
      dados.

## Canonical e noindex

- [ ] Toda página pública tem `alternates.canonical` na metadata,
      apontando para a URL canônica (evita penalização por conteúdo
      duplicado em params de tracking/paginação).
- [ ] Página que existe mas não deve ser indexada (staging, preview,
      variante de teste A/B, página de agradecimento) usa
      `robots: { index: false }` na metadata do Next.js, em vez de
      confiar só no `robots.txt`.

## Antes de implementar

Verifique se `app/robots.ts`/`app/sitemap.ts` (ou seus equivalentes
estáticos em `public/`) já existem — atualize em vez de duplicar.

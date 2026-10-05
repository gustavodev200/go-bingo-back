---
description: Audita e implementa melhorias de SEO, indexação, visibilidade para IA (llms.txt/GEO) e conteúdo de conversão (FAQ, cases, posicionamento) nas páginas públicas.
---

# /seo

Não é uma fase do fluxo SpecKit (`/speckit-specify` ... `/review`) — é um
comando de auditoria + implementação para as páginas **públicas** do
projeto, a rodar sob demanda (lançamento, revisão periódica, antes de uma
campanha).

1. Leia `project.config.json` para saber o preset (a skill `seo` depende
   do Next.js do frontend, não do backend/database escolhido).
2. Analise a estrutura atual antes de mexer: páginas públicas existentes,
   `app/robots.ts`/`public/robots.txt`, `app/sitemap.ts`, `llms.txt`, FAQ,
   cases, metadata já configurada. **Não crie arquivo ou página que já
   existe ou que pode ser obtida melhorando o que já existe.**
3. Carregue as referências relevantes da skill `seo` (nem toda rodada
   precisa das seis):
   - `references/llms-txt.md` — criar/revisar `/llms.txt`.
   - `references/robots-sitemap.md` — `robots.txt`, sitemap, canonical,
     `noindex`. Lembre: robots.txt não protege rota privada — isso é
     autenticação (skill `security`).
   - `references/on-page-seo.md` — auditoria de title/description/
     headings/OG/alt/links internos por página pública.
   - `references/ai-search-geo.md` — clareza semântica para busca
     generativa/IA.
   - `references/content-conversion.md` — FAQ (5 dores reais), página de
     posicionamento/prova, cases com storytelling. **Regra crítica: nunca
     inventar cliente, depoimento, métrica ou resultado** — sem dado real,
     crie só a estrutura vazia.
   - `references/accessibility.md` — checklist WCAG 2.2 completo (POUR,
     contraste, teclado, foco, formulário, autenticação acessível).
   - `references/performance.md` — validação de não-regressão de
     performance/responsividade.
4. Implemente as melhorias, priorizando maior impacto de descoberta/
   conversão com a menor complexidade nova (YAGNI vale aqui também).
5. Valide antes de reportar como concluído: indexação, IA, conteúdo, SEO,
   performance, acessibilidade — ver o checklist final de
   `references/performance.md`. Arquivo criado não é sinônimo de tarefa
   concluída.
6. Salve o relatório final em `seo-audits/<YYYY-MM-DD>-seo-report.md` na
   raiz do projeto, com as seções:

```text
## Implementado
## Arquivos modificados
## Rotas criadas
## SEO
## AI Visibility
## Conversão
## Performance
## Pendências (conteúdo que depende de dado real: depoimento, case, métrica)

## Status
SEO: OK / ATENÇÃO
Indexação: OK / ATENÇÃO
AI Visibility: OK / ATENÇÃO
Conteúdo: OK / ATENÇÃO
Conversão: OK / ATENÇÃO
Performance: OK / ATENÇÃO
Acessibilidade: OK / ATENÇÃO
```

Regra principal: priorizar SEO + AI Visibility + Conteúdo + Autoridade +
Conversão + Performance sem complexidade desnecessária e sem inventar
informação sobre produto, usuário ou resultado.

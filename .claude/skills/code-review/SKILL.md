---
name: code-review
description: Use na fase Code Review do SpecKit (comando /review), depois de Tests e Security Review — checklist de qualidade e consistência para Next.js/NestJS/Prisma/Supabase. Preset-agnóstica.
---

# Code Review

Última fase do fluxo SpecKit, depois que Security Review já rodou. Foca em
correção, simplicidade e consistência — não repete o checklist de
segurança (isso já foi coberto por `/security`; aqui você confirma que os
achados da Security Review foram de fato endereçados).

## Checklist

### Correção

- [ ] O código faz o que o `spec.md` pede — releia a spec, não só o diff.
- [ ] Casos de borda da seção `## Clarifications` do `spec.md` estão de
      fato tratados no código, não só mencionados no plano.
- [ ] Testes da fase Tests cobrem o que o `tasks.md` prometia.

### Simplicidade e reuso (YAGNI)

- [ ] Sem abstração introduzida para caso hipotético não pedido pela spec.
- [ ] Sem duplicação que já existe como skill/util no workspace (ex.:
      reimplementar validação que Zod já cobre, componente que shadcn já
      tem).
- [ ] Nomes de variável/função claros o suficiente para dispensar
      comentário explicativo do "o quê".

### Consistência com o preset

- [ ] Nenhum código do preset errado vazou (ex.: import de `@prisma/client`
      num projeto Supabase, ou vice-versa) — confirme via
      `project.config.json`.
- [ ] Convenções das skills de stack aplicadas (ver `frontend/*`,
      `backend/nestjs`, `prisma` ou `supabase`, conforme o preset).

### Segurança (confirmação, não re-auditoria)

- [ ] Todo item marcado "pendente" no `security-review.md` foi resolvido
      ou explicitamente aceito como risco pelo usuário antes de aprovar.

### Performance

- [ ] Nenhum N+1 óbvio introduzido (ver skill `performance`).

## Formato do achado

Ao registrar um achado em `code-review.md`, seja específico e acionável:
arquivo + linha, o que está errado, por que importa, como corrigir. Evite
comentário de estilo puro sem impacto funcional, a menos que quebre
convenção documentada numa skill.

## YAGNI

Não introduza uma ferramenta de lint/análise estática nova só para esta
revisão — use o que o projeto já tem configurado (ESLint, TypeScript
strict, etc.).

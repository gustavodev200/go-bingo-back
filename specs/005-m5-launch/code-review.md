# Code Review: M5 — Polimento e lançamento (back)

- **Spec**: `docs/PRD.md` §6.1/§1.4/§3.4 | **Plan**: `docs/superpowers/plans/2026-10-08-m5-launch.md` (Tasks 5–8) | **Security Review**: `specs/005-m5-launch/security-review.md` (Gate: PASS WITH WARNINGS)
- **Status**: Mudanças solicitadas — o código revisado não tem achado bloqueante; falta só a decisão do usuário sobre os itens pendentes da Security Review (ver Conclusão).

Escopo revisado: `git diff 854b6fa..2466aed` (RLS, limpeza de convidados, Sentry, logs JSON) mais as
correções feitas nesta fase (`cd27b8c`, `25449a5`, `c202ff9`). Skill: `.claude/skills/code-review/SKILL.md`.

## Achados

| Arquivo:Linha | Severidade | Problema | Correção sugerida |
|---|---|---|---|
| `src/guests/guest-cleanup.service.ts:19-20` | média | Falha do cron diário só ia para o log (04:00 UTC, ninguém olha); o resto do M5 manda erro não-domínio ao Sentry. | **Corrigido** em `c202ff9`: `Sentry.captureException(error)` no `run()`, com teste que falhava antes. |
| `src/configure-app.ts:18-24` | média | `trust proxy = true` deixava o cliente escolher o `req.ip` (achado M1 da Security Review). | **Corrigido** em `cd27b8c` (`trust proxy = 1`) + `test/throttle.e2e-spec.ts`. |
| `src/game/game.gateway.spec.ts` (`onReplay`) | baixa | Faltava teste de que `game:replay` recusa quem não é host (as outras 3 ações de host tinham). | **Corrigido** em `25449a5`. O teste passou de primeira: documenta o comportamento, não corrige bug. |
| `src/guests/guest-cleanup.service.ts:42-44` | baixa | Apagar `Profile` por SQL derruba `RoomMember` em cascata sem passar por `MembershipService.leave` (sem fechar sala/transferir host); `Room.hostId` e `Card.userId` não têm FK. Na prática quase impossível — o boot arma a expiração de presença de todo membro (`GameRunner.onApplicationBootstrap`), então um convidado parado há 30 dias não continua membro. | Sem ação agora; se virar problema, excluir do DELETE perfis com `RoomMember` em sala não fechada. |
| `src/game/game-runner.service.ts:71-74` | baixa | Erro no `tick` do sorteio só vai para o log (código anterior ao M5); inconsistente com o resto, que agora usa o Sentry. Como o `tick` repete a cada intervalo, um erro persistente inundaria o Sentry se fosse capturado sem cuidado. | Capturar só o primeiro erro por `gameId` (ou amostrar) no `catch`. |
| `src/instrument.ts:4` / `src/main.ts:6` | baixa | `import 'dotenv/config'` duplicado (o de `instrument.ts` é o que vale, pois roda primeiro). Inofensivo. | Opcional: remover o de `main.ts`. |

Pontos verificados sem achado:

- **Correção**: RLS cobre as 6 tabelas + `_prisma_migrations`, sem policies (Task 5); a regra dos 30 dias com sessão
  renovada protege quem ainda joga (risco 2 do plano, e2e `guests.e2e-spec.ts`); Sentry com DSN opcional, só 5xx
  e erros não-domínio do WS (Task 7); eventos `game_started`, `game_ended`, `bingo_won`, `bingo_rejected`,
  `presence_reconnected` e `guest_cleanup` com `roomCode`/`gameId` (Task 8).
- **Simplicidade/YAGNI**: nada de abstração extra; `buildLogger` usa o `ConsoleLogger({ json: true })` nativo do Nest
  em vez de outra lib de log.
- **Consistência com o preset** (`prisma-postgres`): Prisma é dono do schema; nenhum `supabase-js` no back;
  SQL raw só em tagged templates.
- **Performance**: sem N+1 novo; o cleanup é 2 statements set-based uma vez por dia.

## Confirmação de itens da Security Review

- [ ] Todo item "Pendente" de `security-review.md` foi resolvido ou explicitamente aceito como risco.
  **Não**: M2 (MEDIUM), L1, L2 (LOW) e I1 (INFO) aguardam decisão do usuário. Este agente não aceitou nenhum risco.

## Confirmação de escopo

- [x] Implementação cobre os requisitos do back do M5 previstos nas Tasks 5–8 do plano.
- [x] Nenhuma funcionalidade fora do escopo foi adicionada (as correções desta fase são de segurança/observabilidade, com teste).
- [x] Testes existem e passam: `npm run lint` (0 erros, 1 warning pré-existente em `test/health.e2e-spec.ts`),
  `npm run typecheck`, `npm run test:cov` e `npm run test:e2e` — resultados no relatório da Task 12.
- Fora deste diff: Task 10 (Dockerfile/deploy/CI do back) não está no branch — não há deploy nesta etapa.

## Conclusão

**Mudanças solicitadas**, só por causa da regra do `/review`: não dá para declarar "Aprovado" com itens pendentes
na Security Review. O que falta para aprovar:

1. Usuário decidir M2 (recomendação: corrigir antes do beta — limite por `user.id` e teto de sockets).
2. Usuário decidir L1, L2 e I1 (corrigir ou registrar em "Riscos aceitos explicitamente" com aprovação).

As sugestões baixas acima (tick do sorteio no Sentry, cascata do cleanup, `dotenv` duplicado) não bloqueiam.

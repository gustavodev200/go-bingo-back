# Security Review: M5 — Polimento e lançamento (back)

- **Plan relacionado**: `docs/superpowers/plans/2026-10-08-m5-launch.md` (spec = `docs/PRD.md` §6.1/§3.4; não há `spec.md`/`plan.md` SpecKit para o M5)
- **Status**: Aprovado com ressalvas (itens em "Pendente — decisão do usuário")
- **Auditoria completa relacionada**: `security-audits/2026-10-06-full-audit.md`

Obrigatoriedade (SECURITY.md): sim — mexe em autenticação/tabela (RLS), dado de usuário
(apaga convidados em `auth.users`) e integração externa nova (Sentry).

Limite desta revisão: **não existe Supabase de produção nem deploy**. RLS foi validada pela
migration + `test/rls.e2e-spec.ts`; throttle atrás de proxy por e2e local simulando o
`X-Forwarded-For`; Sentry pela configuração do SDK (nenhum evento real inspecionado).

## Escopo da alteração

- Feature/correção: `git diff 854b6fa..2466aed` — RLS em todas as tabelas Prisma
  (`7cd5bf8`), cron diário de limpeza de convidados (`242ff14`), Sentry no Nest (`59adcbc`),
  logs JSON com `roomCode`/`gameId` e eventos de ciclo de jogo (`2466aed`).
- Arquivos: `prisma/migrations/20261006000000_enable_rls/migration.sql`, `prisma/schema.prisma`,
  `src/guests/*`, `src/instrument.ts`, `src/main.ts`, `src/app.module.ts`, `src/core/env.ts`,
  `src/core/http-error.filter.ts`, `src/core/logging.ts`, `src/game/game.gateway.ts`,
  `src/game/game-runner.service.ts`, `test/rls.e2e-spec.ts`, `test/guests.e2e-spec.ts`,
  dependências novas `@sentry/nestjs`, `@nestjs/schedule`.
- Superfície existente reavaliada junto (pedido do controlador): REST (`/me`, `/rooms`, `/ranking`,
  `/health`), handshake e eventos do Socket.IO `/game`, ações de host, rate limits, CORS, Helmet.
- Blast radius:
  - `HttpErrorFilter` (agora chama o Sentry) é global → todas as rotas HTTP; só 5xx vão ao Sentry
    (teste `envia ao Sentry só erro 500`).
  - `GameGateway.handle` (Sentry em erro não-domínio) → todos os 10 eventos do cliente.
  - `main.ts`/`instrument.ts` → boot inteiro; `instrument` é importado primeiro.
  - RLS → afeta só acesso via PostgREST (anon/authenticated); Prisma conecta como dono e não é
    afetado (e2e completos verdes).
  - Cleanup apaga `auth.users` e `Profile` → `RoomMember` cai em cascata; `Room.hostId`/`Card.userId`
    sem FK (ver code-review).

## "Não confie no frontend"

Chamando a API/socket direto, sem o front: identidade sempre do JWT (`socket.data.user`/`@CurrentUser`);
o único `userId` aceito do cliente é o alvo de `room:kick`, e quem chuta precisa ser `room.hostId`
lido do banco. O cron não tem rota: `GuestCleanupService` só é provider de `GuestsModule`, disparado por
`@Cron('0 4 * * *')`; nenhum controller/gateway o injeta (`grep GuestCleanupService src` confirma).

## Achados

```text
Vulnerabilidade: Throttle HTTP contornável forjando X-Forwarded-For (trust proxy = true)
Severidade: MEDIUM
Arquivo: src/configure-app.ts
Linha: 18-20 (antes da correção)
Componente/Endpoint: ThrottlerGuard global (todas as rotas HTTP)
Evidência: CONFIRMADO (test/throttle.e2e-spec.ts falhava: 101ª requisição = 200)
Como pode ser explorada: com `trust proxy = true` o req.ip é a entrada mais à esquerda do
  X-Forwarded-For, escolhida pelo cliente; um valor novo por requisição = balde novo.
Impacto: rate limit HTTP sem efeito em produção (TRUST_PROXY=true no Fly).
Correção recomendada: `trust proxy = 1` (só o proxy imediato). APLICADA — commit cd27b8c.
Como validar a correção: `test/throttle.e2e-spec.ts` (429 na 101ª) + `src/configure-app.spec.ts`.
```

```text
Vulnerabilidade: Socket.IO sem limite de conexões por usuário/IP; rate limit por socket.id
Severidade: MEDIUM
Arquivo: src/game/game.gateway.ts
Linha: 84-96, 421-432
Componente/Endpoint: handshake /game e todos os eventos
Evidência: CONFIRMADO pelo código (não exercitado em carga)
Como pode ser explorada: um usuário (convidado anônimo serve) abre N sockets com o mesmo token;
  cada handshake faz upsert em Profile e cada socket ganha 10 ações/s próprias.
Impacto: N × 10 escritas/s no banco por usuário; pressão no pool e na memória da instância única.
Correção recomendada: limiter por user.id + teto de sockets simultâneos por usuário e de
  handshakes por IP. PENDENTE — decisão do usuário.
Como validar a correção: e2e com 6 sockets do mesmo usuário (6º recusado) e flood em 2 sockets.
```

```text
Vulnerabilidade: Socket permanece autenticado após o exp do JWT
Severidade: LOW
Arquivo: src/game/game.gateway.ts
Linha: 84-96
Componente/Endpoint: handshake /game
Evidência: CONFIRMADO pelo código
Como pode ser explorada: sessão revogada/expirada continua usando um socket já aberto.
Impacto: janela de acesso após revogação (~duração da conexão).
Correção recomendada: `setTimeout(() => socket.disconnect(true), exp*1000 - Date.now())` no
  middleware; front reconecta com token renovado. PENDENTE — decisão do usuário.
Como validar a correção: unit com relógio falso (socket desconectado no exp).
```

```text
Vulnerabilidade: 4 HIGH do npm audit --omit=dev na cadeia do CLI prisma (deepmerge-ts, mysql2)
Severidade: LOW (não alcançável em runtime)
Arquivo: package-lock.json
Componente/Endpoint: prisma@7.10.0 → @prisma/config → deepmerge-ts@7.1.5; prisma → mysql2@3.15.3
Evidência: CONFIRMADO (npm audit); exploração NÃO REPRODUZIDA — a app não usa MySQL nem mescla
  objeto de usuário com deepmerge-ts.
Correção recomendada: não usar `audit fix --force` (downgrade p/ prisma 6.19.3); atualizar quando
  sair patch 7.x; no Docker, CLI só no estágio de build/migrate. PENDENTE — decisão do usuário.
Como validar a correção: `npm audit --omit=dev` sem HIGH.
```

```text
Vulnerabilidade: jwtVerify sem allowlist explícita de algoritmos
Severidade: INFORMATIONAL
Arquivo: src/core/auth/jwt-verifier.ts
Linha: 26-29
Evidência: FALSE POSITIVE como vulnerabilidade — jose rejeita `alg: none` e o JWKS remoto só
  expõe chaves públicas assimétricas (sem alg-confusion com HS256).
Correção recomendada (hardening): `algorithms: ['ES256','RS256']` após confirmar o alg das
  chaves do projeto de produção. Pendente — decisão do usuário.
```

Outros informativos (sem ação obrigatória): `.env.test` versionado só com credenciais locais;
`userId` UUID nos logs (pseudônimo); socket com token expirado recusado (mesmo `JwtVerifier`, unit
`rejects an expired token`).

## Checklist por tópico

### Autenticação e Autorização (`references/auth-authz.md`)

- [x] JWT: `iss` fixado em `${SUPABASE_URL}/auth/v1`, `aud = 'authenticated'`, `exp` validado — Resolvido — `jwt-verifier.ts:21,26-29`; unit cobre iss/aud/exp/chave forjada/sem sub
- [x] Algoritmo — Resolvido com ressalva — jose + JWKS assimétrico; allowlist explícita = informativo pendente
- [x] Segredo de assinatura não hardcoded — Resolvido — só JWKS público remoto
- [x] Identidade só do token — Resolvido — `events.ts`: único `userId` do cliente é `kickPayloadSchema`
- [x] Ações de host checam `room.hostId` no servidor — Resolvido — kick/cancel/replay (`assertHost`), start (`games.start`); testes em `membership.e2e`, `games.e2e`, `gateway.e2e`, unit de replay (25449a5)
- [x] IDOR — Resolvido — mark só na própria cartela (`games.e2e`)
- [x] Socket sem token / token inválido recusado — Resolvido — `gateway.e2e` "rejects connections without a valid token"
- [ ] Sessão expira no socket aberto — Pendente — L1
- [ ] Senha/hash/reset/login — Não aplicável — Supabase Auth

### Injection (`references/injection.md`)

- [x] SQL raw parametrizado — Resolvido — `guest-cleanup.service.ts` usa `$queryRaw`/`$executeRaw` tagged (cutoff como parâmetro), sem concatenação; `$executeRawUnsafe` só em testes
- [x] DELETE em `auth.users` restrito a anônimos inativos e sem caminho HTTP/WS — Resolvido — só `@Cron`; e2e `guests.e2e-spec.ts` prova que registrado e anônimo com sessão recente ficam
- [x] XSS — Não aplicável no back (API JSON); nome de sala/apelido renderizados como texto no front
- [x] CSRF — Não aplicável — auth por header, sem cookie
- [x] SSRF / Path traversal / Command injection — Não aplicável

### API (`references/api-security.md`)

- [x] Rate limit HTTP por IP real atrás de proxy — Resolvido — M1 corrigido (cd27b8c)
- [ ] Rate limit/conexões no Socket.IO por usuário — Pendente — M2
- [x] 429 genérico — Resolvido — `RATE_LIMITED` "Muitas requisições, tente em instantes"
- [x] CORS allowlist exata (HTTP e Socket.IO) — Resolvido — `CORS_ORIGIN` (z.url) em `enableCors` e `GameIoAdapter`
- [x] Headers (Helmet) — Resolvido — `helmet()` defaults
- [x] Mass assignment — Resolvido — Zod com campos explícitos; `.strict()` em payload vazio
- [x] Erro sem stack trace — Resolvido — `toHttpError` devolve `{code,message}`; 500 = "Erro interno"; WS idem
- [x] Webhooks — Não aplicável

### Secrets, Dados, Logs, Dependências, Config (`references/data-secrets-logging.md`)

- [x] Sem segredo versionado — Resolvido — `git grep service_role`/`sb_secret` e `git log -S sb_secret --all` só acham o plano, um teste e um template vazio
- [x] `.env*` fora do git — Resolvido — `.env` ignorado; versionados só `.env.example` e `.env.test` (sem segredo)
- [x] Logs sem token/e-mail/apelido — Resolvido — campos: event, roomCode, gameId, userId, drawIntervalMs, reason, contagens
- [x] Sentry sem PII — Resolvido no código — `dataCollection` tudo desligado, `httpBodies: []`; só 5xx/erros não-domínio. Eventos reais não inspecionados (sem DSN)
- [x] Falha do cron visível — Resolvido — Sentry no `run()` (c202ff9)
- [ ] Dependências sem HIGH — Pendente — L2 (CLI prisma, não alcançável em runtime)
- [x] Config de produção — Resolvido — env validada por Zod; `/health` só `{status:'ok'}`; sem Swagger/debug

### Upload de Arquivos

Não aplicável.

### RLS (`references/supabase-rls.md`)

Preset é `prisma-postgres`, mas o Postgres está no Supabase com PostgREST exposto; checklist aplicado:

- [x] RLS em toda tabela do `public` — Resolvido — migration `20261006000000_enable_rls` (6 tabelas + `_prisma_migrations`); `test/rls.e2e-spec.ts` falha se alguma tabela `public` ficar sem `relrowsecurity`
- [x] Nenhuma policy (estado bloqueado) — Resolvido — nenhuma `CREATE POLICY`
- [x] Tabela nova lembra do ALTER — Resolvido — comentário no `schema.prisma` + o e2e acima pega esquecimento
- [ ] PostgREST com chave publicável de produção devolve `[]`/erro — Não foi possível validar (sem projeto de produção)
- [x] service role — Não aplicável — o back não usa chave service role (conexão Postgres direta)

## Pendente — decisão do usuário

Nenhum destes foi aceito como risco por este agente; cada um precisa de decisão explícita.

| Item | Severidade | Recomendação |
|---|---|---|
| M2 — Socket.IO sem limite por usuário/conexão | MEDIUM | **Corrigir antes do beta**: limiter por `user.id` + teto de 5 sockets por usuário + limite de handshakes por IP. |
| L1 — socket não expira com o JWT | LOW | Corrigir no curto prazo junto com o front (disconnect no `exp`, reconexão com token renovado). Aceitável no beta fechado se o usuário aprovar. |
| L2 — HIGH do `npm audit` no CLI do Prisma | LOW | Aceitar até sair patch 7.x, com reavaliação a cada release; não fazer downgrade forçado. |
| I1 — allowlist de `alg` no `jwtVerify` | INFO | Aplicar `['ES256','RS256']` quando o projeto de produção existir e o alg das chaves for confirmado. |
| Checagens de produção (PostgREST, XFF do Fly, eventos do Sentry) | — | Repetir no primeiro deploy; não validadas aqui. |

## Riscos aceitos explicitamente

Nenhum (aguardando decisão do usuário sobre a tabela acima).

## Security Gate

```text
Status: PASS WITH WARNINGS

CRITICAL: 0
HIGH: 0
MEDIUM: 2 (1 corrigido, 1 pendente)
LOW: 2 (pendentes)
INFORMATIONAL: 4
```

Sem CRITICAL/HIGH → liberado para `/review`. Os avisos são M2, L1, L2 e I1, todos registrados em
"Pendente — decisão do usuário". Não é PASS limpo enquanto M2 não for decidido.

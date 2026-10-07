# Security Audit Report — 2026-10-06 (go-bingo-back)

Processo: `.claude/commands/security-audit.md` + `.claude/skills/security/references/full-audit.md`.
Branch auditada: `feat/m5-launch` (HEAD antes das correções: `2466aed`).
Preset: `prisma-postgres` (Supabase só para Auth — `project.config.json`).

## 1. Executive Summary

Auditoria **estática do código** (leitura do fluxo real dos dados) + execução dos
testes unit/e2e locais. **Não há ambiente de produção** (nenhum projeto Supabase de
produção, nenhum deploy): checagens contra produção (PostgREST com chave publicável,
`X-Forwarded-For` real do Fly, eventos reais no painel do Sentry) **não foram
possíveis de validar** e estão marcadas como tal.

Resultado: nenhum CRITICAL/HIGH. 2 MEDIUM (1 corrigido com teste — bypass do
throttle HTTP via `X-Forwarded-For` forjado; 1 pendente de decisão), 2 LOW
pendentes, 5 informativos.

SECURITY STATUS: **NO CRITICAL-HIGH ISSUES FOUND** (dentro do escopo e dos testes realizados).

## 2. Scope

- Todo `src/` (NestJS 11, Express, Socket.IO 4, Prisma 7, jose 5, @sentry/nestjs 11),
  `prisma/` (schema + 2 migrations), `test/` (e2e), `.env*`, `package.json`, `docker-compose.yml`.
- Fora do escopo: front (`go-bingo-front`, auditado separadamente), configuração do
  projeto Supabase (Auth, CAPTCHA, rate limits do GoTrue), infraestrutura Fly (não existe ainda).
- Semgrep não está instalado no projeto — não rodado.

## 3. Architecture

API NestJS stateful em 1 instância. Identidade = JWT do Supabase Auth (Google ou
anônimo), verificado com JWKS remoto (`src/core/core.module.ts`, `src/core/auth/jwt-verifier.ts`).
Dados no Postgres via Prisma como dono do schema (RLS ligada e sem policies, então
PostgREST não vê nada). Tempo real via Socket.IO no namespace `/game`
(`src/game/game.gateway.ts`). Cron diário de limpeza de convidados (`src/guests/`).
Sentry opcional por DSN (`src/instrument.ts`). Logs JSON em produção (`src/core/logging.ts`).

## 4. Attack Surface

| Superfície | Auth | Autorização | Entrada | Observação |
|---|---|---|---|---|
| `GET /health` | não | — | — | retorna só `{status:'ok'}` |
| `GET /me` | JWT (`HttpAuthGuard`) | dono = `sub` | — | cria o perfil no 1º acesso |
| `PATCH /me` | JWT | dono = `sub` | `{nickname}` (ZodPipe + regex + blocklist) | |
| `POST /rooms` | JWT | host = `sub` | `createRoomSchema` | |
| `GET /rooms`, `GET /rooms/:code` | JWT | público (salas públicas / resumo) | `roomCodeSchema` | |
| `GET /ranking?cursor=` | JWT | público entre logados | `cursor` int ≥ 0 | `Cache-Control: private` |
| WS `/game` handshake | `auth.token` (JWT) | — | token string | recusa com `UNAUTHENTICATED` |
| `rooms:watch`, `room:join`, `room:leave` | socket autenticado | membro / nickname exigido | `code` | |
| `room:kick`, `room:cancel`, `game:start`, `game:replay` | socket | **host** (`room.hostId` do banco) | `kick.userId` uuid | |
| `card:generate`, `card:mark`, `bingo:claim` | socket | membro / dono da cartela | `index` 0–24 | |
| Cron `GuestCleanupService.run` (04:00 UTC) | — | sem caminho HTTP/WS | — | SQL raw em `auth.users` |

## 5. Security Score (qualitativo)

| Área | Nota | Nota curta |
|---|---|---|
| Authentication | Bom | JWKS + `iss` + `aud` + `exp`; socket só valida no handshake (L1) |
| Authorization | Bom | identidade só do token; host checado no servidor |
| Input Validation | Bom | Zod em toda entrada HTTP/WS, `.strict()` em payload vazio |
| API Security | Bom após correção | throttle HTTP corrigido (M1); WS por socket (M2) |
| Database Security | Bom | RLS em todas as tabelas; SQL raw parametrizado |
| Infrastructure | Não avaliável | sem Dockerfile/Fly ainda |
| Dependencies | Atenção | 4 HIGH no `npm audit --omit=dev`, todos na cadeia do CLI `prisma` (L2) |
| Secrets | Bom | nada versionado; `.env` ignorado |
| Logging | Bom | sem token/e-mail/apelido; Sentry com coleta de PII desligada |
| Business Logic | Bom | claims concorrentes, pontos e regen cobertos por e2e |
| Frontend Security | N/A | repo do front |

## 6. Critical Findings

Nenhum.

## 7. High Findings

Nenhum.

## 8. Medium Findings

### M1 — Throttle HTTP contornável forjando `X-Forwarded-For` — **CORRIGIDO**

```text
Vulnerabilidade: rate limit HTTP por IP contornável (API4)
Severidade: MEDIUM
Arquivo: src/configure-app.ts
Linha: 18-20 (antes da correção)
Componente/Endpoint: ThrottlerGuard global (todas as rotas HTTP)
Evidência: CONFIRMADO — test/throttle.e2e-spec.ts falhou antes da correção (101ª requisição = 200)
Como pode ser explorada: com TRUST_PROXY=true o Express usava `trust proxy = true`, que faz
  req.ip = entrada MAIS À ESQUERDA do X-Forwarded-For (enviada pelo cliente). O
  ThrottlerGuard usa req.ip como chave; trocar o valor a cada requisição = balde novo.
Impacto: sem limite efetivo nas rotas HTTP em produção (rotas autenticadas, exceto /health).
Correção: `app.set('trust proxy', 1)` — confia só no proxy imediato (o Fly acrescenta o IP
  real no fim do header). Commit cd27b8c.
Como validar: test/throttle.e2e-spec.ts (100 × 200, depois 429 com XFF forjado e IP real fixo)
  e src/configure-app.spec.ts.
```

Observação: se no futuro houver mais de um proxy (ex.: Cloudflare na frente do Fly), o hop precisa subir.

### M2 — Socket.IO sem limite de conexões; rate limit por `socket.id` — **PENDENTE (decisão do usuário)**

```text
Vulnerabilidade: consumo de recurso não limitado no tempo real (API4)
Severidade: MEDIUM
Arquivo: src/game/game.gateway.ts
Linha: 84-96 (handshake), 421-432 (limiter)
Evidência: CONFIRMADO pelo código (não explorado em carga)
Como pode ser explorada: um usuário com token válido (convidado anônimo serve) abre N
  sockets; cada handshake faz upsert em Profile, e cada socket tem seu próprio balde de
  10 ações/s (chave = socket.id). O throttle HTTP não cobre o handshake do Socket.IO.
Impacto: N × 10 ações/s com escrita no banco (card:mark, card:generate) por um único usuário;
  pressão em memória e no pool de conexões.
Correção recomendada: chave do limiter por user.id (não socket.id) e teto de sockets
  simultâneos por usuário (ex.: 5) e de handshakes por IP/minuto, checado no middleware.
Como validar: e2e abrindo 6 sockets com o mesmo token → o 6º recebe connect_error; flood
  distribuído em 2 sockets do mesmo usuário → RATE_LIMITED após 10 no total.
```

## 9. Low Findings

### L1 — Socket continua autenticado depois do `exp` do JWT — PENDENTE

```text
Severidade: LOW · Evidência: CONFIRMADO pelo código
Arquivo: src/game/game.gateway.ts:84-96
O token só é verificado no handshake. Uma sessão revogada/expirada mantém o socket ativo
até desconectar (access token do Supabase dura ~1 h).
Correção recomendada: agendar `socket.disconnect()` no `exp` do token (o front reconecta com
o token renovado) — coordenar com o front.
```

### L2 — `npm audit --omit=dev`: 4 HIGH na cadeia do CLI `prisma` — PENDENTE

```text
Severidade: LOW (exposição real) · Evidência: CONFIRMADO (npm audit) / não alcançável em runtime
Pacotes: deepmerge-ts <8 (GHSA-ggr8-5vv4-36mx), mysql2 <=3.23.0 (GHSA-3f6p-5ww8-9rcr,
GHSA-rgwj-5xj2-c3m3), via @prisma/config → prisma@7.10.0. `prisma` é devDependency, mas
entra na árvore de produção como peer de @prisma/client.
Por que LOW: a app não usa MySQL e não mescla objeto de usuário com deepmerge-ts — só o CLI
(migrate/generate) toca esse código, com entrada local.
`npm audit fix --force` propõe prisma@6.19.3 (downgrade de major) — NÃO aplicar.
Plano recomendado: acompanhar o patch do Prisma 7.x e atualizar; no Dockerfile, rodar o
CLI só no estágio de build/migrate.
```

## 10. Informational

- **I1 — JWT sem allowlist explícita de `alg`** (`src/core/auth/jwt-verifier.ts:26`). `jwtVerify`
  do jose não aceita `alg: none` e o JWKS remoto só traz chaves públicas assimétricas, então
  alg-confusion não é explorável (FALSE POSITIVE como vulnerabilidade). Hardening sugerido:
  `algorithms: ['ES256', 'RS256']` depois de confirmar o algoritmo das chaves do projeto de produção.
- **I2 — `.env.test` versionado**: só credenciais do Postgres local do docker-compose
  (`bingo:bingo@localhost`) e `SUPABASE_URL` fictícia. Sem segredo.
- **I3 — `userId` (UUID) nos logs estruturados**: pseudônimo, não é token/e-mail/apelido.
- **I4 — Limpeza de convidados** apaga `Profile`; `Room.hostId` e `Card.userId` não têm FK e
  podem ficar apontando para um id removido (integridade, não segurança).
- **I5 — Socket com token expirado**: recusado pelo mesmo `JwtVerifier` (teste unitário
  `rejects an expired token` + middleware do handshake); o e2e do gateway cobre só sem token/lixo.

## 11. OWASP API Security Top 10

| Categoria | Status | Evidência | Risco |
|---|---|---|---|
| API1 BOLA | PASS | ids sempre do token; `games.e2e` "can't mark a cell using another player's card" | — |
| API2 Broken Authentication | PASS | `jwt-verifier.spec.ts` (iss, aud, exp, chave forjada, sem sub); handshake recusa | L1 |
| API3 BOPLA | PASS | DTOs de saída explícitos (`toDto`, snapshot só com `myCard`) | — |
| API4 Unrestricted Resource Consumption | PARTIAL | M1 corrigido; M2 pendente | M2 |
| API5 Broken Function Level Authz | PASS | host checado no servidor (`assertHost`, `games.start`); e2e por ação | — |
| API6 Sensitive Business Flows | PASS | claim com limite 1/2 s e e2e de claims concorrentes | — |
| API7 SSRF | N/A | nenhuma URL vinda do cliente; JWKS de `SUPABASE_URL` (env) | — |
| API8 Security Misconfiguration | PASS | Helmet, CORS exato, filtro de erro sem stack | — |
| API9 Improper Inventory | PASS | sem Swagger/rota de debug; superfície acima | — |
| API10 Unsafe Consumption of APIs | PASS | só JWKS do Supabase via jose | — |

## 12. OWASP ASVS

| Área | Status | Observação |
|---|---|---|
| V1 Architecture | OK | identidade só do token; Prisma dono do schema |
| V2 Authentication | OK | delegada ao Supabase; verificação local correta |
| V3 Session Management | Parcial | L1 (socket não reavalia `exp`) |
| V4 Access Control | OK | host/membro no servidor |
| V5 Validation | OK | Zod em toda entrada |
| V6 Stored Cryptography | N/A | sem segredo armazenado; `crypto.randomInt` para sorteio/código |
| V7 Error Handling and Logging | OK | 500 genérico; Sentry só 5xx; sem PII |
| V8 Data Protection | OK | RLS; ranking `Cache-Control: private` |
| V9 Communication | Não avaliável | TLS no proxy (sem deploy) |
| V10 Malicious Code | OK | sem eval/exec |
| V11 Business Logic | OK | e2e de concorrência (join, claim, draw) |
| V12 Files and Resources | N/A | sem upload |
| V13 API and Web Service | Parcial | M2 |
| V14 Configuration | OK | env validada por Zod; `.env` fora do git |

## 13. Input Validation Matrix

| Campo | Endpoint | Tipo | Min | Max | Caracteres | Backend | Status |
|---|---|---|---|---|---|---|---|
| nickname | `PATCH /me` | string | 3 | 16 | `[A-Za-z0-9_À-ú ]` + blocklist | `nicknameSchema` | OK |
| name | `POST /rooms` | string (trim) | 3 | 24 | livre (texto) | `createRoomSchema` | OK (renderizar como texto) |
| maxPlayers | `POST /rooms` | literal | 10/15/25 | — | — | union de literais | OK |
| isPublic | `POST /rooms` | boolean | — | — | — | Zod | OK |
| code | `GET /rooms/:code`, `room:join` | string | 6 | 6 | alfabeto sem 0/O/1/I | `roomCodeSchema` | OK |
| cursor | `GET /ranking` | int | 0 | sem máx. | — | `rankingQuerySchema` | OK |
| userId | `room:kick` | uuid | — | — | — | `z.uuid()` | OK |
| index | `card:mark` | int | 0 | 24 | — | Zod | OK |
| payload vazio | demais eventos | `{}` | — | — | — | `.strict()` | OK |
| Authorization / `auth.token` | HTTP / WS | string | — | — | `Bearer ` | `JwtVerifier` | OK |

## 14-25. Auditorias específicas

- **Authentication**: `JwtVerifier` fixa `issuer = ${SUPABASE_URL}/auth/v1` e `audience = 'authenticated'`;
  `exp` validado pelo jose; `sub` obrigatório; `is_anonymous` fail-closed. HTTP exige `Bearer `.
- **Authorization**: `grep userId src/contracts/events.ts` → único `userId` vindo do cliente é
  `kickPayloadSchema` (alvo); quem chuta é `socket.data.user`, e `kick` chama `assertHost`.
  `room:cancel` → `membership.cancel` → `assertHost`; `game:start` → `games.start` checa `room.hostId`;
  `game:replay` → `assertHost`. Testes: `membership.e2e-spec.ts` ("only the host can kick or cancel"),
  `games.e2e-spec.ts` ("needs the host"), `gateway.e2e-spec.ts` (NOT_HOST no start) e, nesta auditoria,
  unit `rejects a replay from someone who is not the host` (commit 25449a5).
- **SQL Injection**: `$queryRaw`/`$executeRaw` só como tagged template com `${}` (parametrizado):
  `membership.service.ts:72`, `guest-cleanup.service.ts:27,33,42`. `$executeRawUnsafe` só em testes, com constantes.
- **XSS**: API JSON; `dangerouslySetInnerHTML` = 0 no back. Nome de sala é texto livre → responsabilidade do front.
- **CSRF**: N/A — autenticação por header `Authorization`, sem cookie.
- **IDOR/BOLA**: ids de usuário nunca vêm do cliente (exceto alvo do kick, checado como host).
- **SSRF**: N/A.
- **File Upload**: N/A.
- **Secrets**: `git grep service_role` → só o plano, um teste (audiência inválida) e `templates/supabase/.env.example` (chave vazia).
  `git grep sb_secret` / `git log -S sb_secret --all` → só o texto do plano. `git ls-files | grep -i env` →
  `.env.example`, `.env.test` (I2), templates e `src/core/env*.ts`; `.env` ignorado.
- **Dependency**: ver L2.
- **Infrastructure**: sem Dockerfile/fly.toml no repo ainda; docker-compose só para Postgres local.
- **Business Logic**: claims concorrentes = 1 vencedor; pontos só para registrado; regen limitada a 5; mark só número sorteado.

## 26. Security Headers

`helmet()` com defaults (HSTS, nosniff, frameguard, CSP padrão, etc.) — `src/configure-app.ts:10`.

## 27. Rate Limiting

- HTTP: `ThrottlerModule` 100 req/60 s por IP, guard global (`HttpThrottlerGuard` pula WS). Com
  `TRUST_PROXY=true` agora confia em 1 hop (M1). Não testado com o `X-Forwarded-For` real do Fly (sem deploy).
- WS: `RateLimiter` em memória, 10 ações/s por socket e 1 claim/2 s (M2).
- CORS: `enableCors({ origin: CORS_ORIGIN })` (string exata, validada como URL) e o mesmo origin no `GameIoAdapter`.

## 28. Logging & Monitoring

- Logs JSON em produção (`buildLogger`). Campos logados: `event`, `roomCode`, `gameId`, `userId`, `drawIntervalMs`,
  `reason`, contagens do cleanup, e objetos de erro em 5xx. Nenhum token, e-mail ou apelido.
- Sentry: `dataCollection` com `userInfo`, `cookies`, `httpHeaders`, `urlQueryParams`, `databaseQueryData`,
  `stackFrameVariables` desligados e `httpBodies: []`; só exceções não-domínio vão ao Sentry.
  Eventos reais no painel **não foram inspecionados** (sem DSN de produção).
- Falha do cron de limpeza agora também vai ao Sentry (commit c202ff9).

## 29. Recommendations

- **Imediato (antes do beta)**: decidir M2 (limite de sockets/ações por usuário). Configurar `TRUST_PROXY=true` no Fly
  (1 hop) e repetir o teste de 101 requisições contra o deploy.
- **Curto prazo**: L1 (desconectar no `exp`); checar RLS com a chave publicável do projeto de produção quando existir.
- **Médio prazo**: L2 (atualizar Prisma quando sair patch); I1 (allowlist de `alg`).
- **Longo prazo**: Semgrep/`npm audit` no CI.

## Conclusão

SECURITY STATUS: **NO CRITICAL-HIGH ISSUES FOUND**

Top problemas (prioridade):

1. M2 — Socket.IO sem limite por usuário/conexão — `game.gateway.ts:84-96,421-432` — limiter por `user.id` + teto de sockets — Alta.
2. M1 — throttle HTTP via XFF forjado — `configure-app.ts` — **corrigido** (cd27b8c).
3. L1 — socket não expira com o JWT — `game.gateway.ts:84-96` — disconnect no `exp` — Média.
4. L2 — vulnerabilidades no CLI do Prisma — `package-lock.json` — atualizar quando houver patch — Baixa.
5. I1 — allowlist de `alg` no `jwtVerify` — `jwt-verifier.ts:26` — Baixa.

Recomendação: **sim, pode seguir para o beta fechado** do ponto de vista do back, desde que o
usuário decida conscientemente sobre M2/L1/L2 e que as checagens de produção (RLS via PostgREST,
XFF do Fly, eventos no Sentry) sejam repetidas quando o ambiente existir — elas não foram validadas aqui.

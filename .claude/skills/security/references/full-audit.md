# Auditoria Completa de Segurança (Whole-App)

Processo para uma auditoria periódica de **toda a plataforma** — não
ligada a uma feature específica. Usado pelo comando `/security-audit`,
tipicamente antes de um marco importante (primeiro lançamento público,
antes de fechar um cliente enterprise, revisão trimestral) e não a
cada feature (para isso, ver `pre-deploy-gate.md`).

Referências: OWASP Web Security Testing Guide (WSTG), OWASP API Security
Top 10, OWASP ASVS 5.0, Secure Coding, Authentication/Authorization/
Database/Infrastructure/Dependency Security.

**Regra fundamental**: não considere a aplicação segura só porque usa ORM,
Prisma, validação, JWT, HTTPS ou framework moderno — verifique se essas
proteções realmente estão aplicadas corretamente, analisando o **fluxo
real do dado**:

```text
Input do usuário → Controller → DTO/Validation → Service → ORM/Query → Database → Response → Frontend
```

Identifique onde dado não confiável pode escapar dessas proteções.

**Regra de não destruição**: nunca apagar/modificar dado real, resetar
senha de usuário real, causar DoS, exfiltrar dado, ou expor secret no
relatório (mascare valores). Ao precisar comprovar uma vulnerabilidade, use
o menor teste possível.

## Fase 1 — Reconhecimento e superfície de ataque

Mapeie: frontend, backend, APIs, endpoints, controllers, services,
repositories, banco, auth, roles/permissions, middleware, guards,
interceptors, pipes, uploads, integrações externas, filas, cron jobs,
webhooks, storage, env vars, Docker, CI/CD, logs, monitoramento.

Para cada endpoint: método, rota, autenticação necessária, role necessária,
parâmetros (path/query/body), dados retornados, recursos acessados, riscos
potenciais.

## Fase 2 — Matriz de validação de entrada

Para cada campo de entrada relevante, monte:

| Campo | Endpoint | Tipo | Min | Max | Caracteres permitidos | Validação backend | Validação frontend | Status |
|---|---|---|---|---|---|---|---|---|

Teste (de forma segura, sem causar DoS): strings vazias/gigantes,
Unicode/emoji, caracteres de controle, null/undefined, números negativos
ou extremos, tipo trocado (array onde é string, objeto onde é número),
propriedade extra inesperada (mass assignment — ver `api-security.md`).

## Fase 3 — Checklist por tópico (reusa as referências existentes)

Não repita aqui o que já está documentado — carregue e aplique:

- `auth-authz.md` — autenticação, hashing, JWT, RBAC, IDOR/BOLA
- `injection.md` — SQLi, XSS, CSRF, SSRF, Path Traversal, Command Injection
- `api-security.md` — rate limiting, CORS, headers, mass assignment, HTTP
  parameter pollution, webhooks
- `data-secrets-logging.md` — secrets, exposição de dados, logs,
  dependências, configuração de produção
- `file-uploads.md` — upload de arquivos
- `supabase-rls.md` — RLS (se preset `supabase`)

Para SQLi especificamente: não assuma que o ORM elimina o risco — audite
todo uso de `$queryRaw`/`$executeRaw` (Prisma) ou RPC/SQL raw (Supabase).

## Fase 4 — Tópicos exclusivos da auditoria completa

Estes não fazem parte do checklist por-feature — só fazem sentido numa
varredura de toda a aplicação:

### Business logic

Procure falha de regra de negócio, não só técnica: acessar recurso sem
pagar, usar recurso após expiração, pular etapa obrigatória de um fluxo,
repetir operação que deveria ser única, manipular preço/quantidade/status,
consumir crédito indefinidamente, contornar limite de plano.

### Infraestrutura / Docker

Se houver Docker: `Dockerfile`/`docker-compose`, usuário root no
container, `--privileged`, `network: host`, socket do Docker montado,
volumes sensíveis, secrets em variável de ambiente do compose versionado,
portas expostas desnecessariamente, imagens desatualizadas.

### Cache / Proxy / CDN

Resposta autenticada/privada sendo cacheada publicamente; headers de cache
(`Cache-Control`, `Vary`) corretos para conteúdo por usuário; risco de
cache poisoning.

### Exports / Relatórios

CSV/Excel gerado a partir de dado de usuário: risco de **formula
injection** (célula começando com `=`, `+`, `-`, `@` sendo interpretada
como fórmula ao abrir no Excel) — escapar/prefixar. Verificar autorização
do export (IDOR em relatório) e volume (DoS via export gigante).

### Cron / Jobs / Filas

Job interno não deve ser disparável por request externo sem autenticação;
idempotência de job que pode ser re-enfileirado; limite de custo/recursos
por execução.

### Fuzzing controlado

Para endpoints centrais, teste (sem risco de derrubar produção): payloads
malformados, tipos trocados, arrays/objetos onde não esperado, parâmetros
duplicados (HTTP Parameter Pollution — ver `api-security.md`). Objetivo:
achar crash, 500 inesperado, bypass de validação, erro de autorização.

## Fase 5 — Mapeamento OWASP

### OWASP API Security Top 10 — status por categoria

| Categoria | Status (PASS/FAIL/PARTIAL/N-A) | Evidência | Risco |
|---|---|---|---|
| API1 Broken Object Level Authorization | | | |
| API2 Broken Authentication | | | |
| API3 Broken Object Property Level Authorization | | | |
| API4 Unrestricted Resource Consumption | | | |
| API5 Broken Function Level Authorization | | | |
| API6 Unrestricted Access to Sensitive Business Flows | | | |
| API7 SSRF | | | |
| API8 Security Misconfiguration | | | |
| API9 Improper Inventory Management | | | |
| API10 Unsafe Consumption of APIs | | | |

### OWASP ASVS — status por área

| Área | Status | Observação |
|---|---|---|
| V1 Architecture | | |
| V2 Authentication | | |
| V3 Session Management | | |
| V4 Access Control | | |
| V5 Validation, Sanitization, Encoding | | |
| V6 Stored Cryptography | | |
| V7 Error Handling and Logging | | |
| V8 Data Protection | | |
| V9 Communication | | |
| V10 Malicious Code | | |
| V11 Business Logic | | |
| V12 Files and Resources | | |
| V13 API and Web Service | | |
| V14 Configuration | | |

## Fase 6 — Evidência e severidade

Mesmas regras do `pre-deploy-gate.md`: classifique cada achado como
CONFIRMADO/PROVÁVEL/POSSÍVEL/NÃO REPRODUZIDO/FALSE POSITIVE, e severidade
CRITICAL/HIGH/MEDIUM/LOW/INFORMATIONAL. Nunca afirme "está seguro" — use
"não foram identificadas vulnerabilidades dentro do escopo e dos testes
realizados". Se não conseguir validar algo, diga "não foi possível
validar".

## Fase 7 — Relatório final

Salve em `security-audits/<YYYY-MM-DD>-full-audit.md` na raiz do projeto
(fora de `specs/`, já que não é uma feature). Estrutura:

```text
# Security Audit Report — <data>

## 1. Executive Summary
## 2. Scope
## 3. Architecture (resumo do que foi encontrado)
## 4. Attack Surface (lista de endpoints)
## 5. Security Score (Authentication, Authorization, Input Validation,
     API Security, Database Security, Infrastructure, Dependencies,
     Secrets, Logging, Business Logic, Frontend Security)
## 6. Critical Findings
## 7. High Findings
## 8. Medium Findings
## 9. Low Findings
## 10. Informational
## 11. OWASP API Top 10 (tabela da Fase 5)
## 12. OWASP ASVS (tabela da Fase 5)
## 13. Input Validation Matrix (tabela da Fase 2)
## 14-25. Auditorias específicas (Authentication, Authorization, SQLi,
     XSS, CSRF, IDOR/BOLA, SSRF, File Upload, Secrets, Dependency,
     Infrastructure, Business Logic)
## 26. Security Headers
## 27. Rate Limiting
## 28. Logging & Monitoring
## 29. Recommendations (Imediato / Curto prazo / Médio prazo / Longo prazo)

## Conclusão

SECURITY STATUS: CRITICAL RISK / HIGH RISK / MEDIUM RISK / LOW RISK / NO CRITICAL-HIGH ISSUES FOUND

Top 10 problemas mais importantes (risco, impacto, localização, correção,
prioridade).

Recomendação objetiva: é seguro prosseguir para produção? Justifique.
```

Não faça correção de código nesta fase — apresente o relatório primeiro e
aguarde autorização explícita do usuário antes de corrigir.

## Ferramenta automatizada opcional (primeira passada)

Antes da análise manual, rodar uma ferramenta de SAST como primeira
passada é útil (ex.: [Semgrep](https://github.com/semgrep/semgrep) —
`semgrep --config auto .`). Trate o resultado como ponto de partida, não
substituto: explique cada achado, corrija sem alterar comportamento, e
rode o mesmo scan de novo depois da correção para confirmar. Ferramenta
automatizada não substitui as fases manuais acima (business logic, IDOR,
RLS não são detectáveis por SAST genérico).

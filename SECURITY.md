# Política e Checklist de Segurança do Workspace

Este documento define o padrão mínimo de segurança que qualquer projeto
gerado a partir deste workspace deve seguir. O checklist detalhado e
acionável para o agente vive em `.claude/skills/security/` — este arquivo é
a referência de alto nível e a política de divulgação.

Três processos de segurança convivem neste workspace, cada um para uma
situação diferente:

| Processo | Quando | Comando | Referência |
|---|---|---|---|
| Security Gate por feature | Toda vez que uma feature/correção termina, antes do deploy | `/security` | `.claude/skills/security/references/pre-deploy-gate.md` |
| Auditoria completa da plataforma | Antes de marco importante (lançamento, cliente enterprise) ou revisão periódica | `/security-audit` | `.claude/skills/security/references/full-audit.md` |
| Checklist de hardening de SaaS | Preparação de produto/organização (não é código de uma feature) | — (manual, sob demanda) | `.claude/skills/security/references/saas-hardening-checklist.md` |

## Quando a fase Security Review é obrigatória

No fluxo SpecKit (`Specification → Clarification → Plan → Tasks →
Implementation → Tests → Security Review → Code Review`), a fase **Security
Review** (`/security`) é obrigatória sempre que a feature:

- cria ou altera autenticação, sessão ou autorização (RBAC/ownership);
- expõe uma nova rota de API, Server Action ou endpoint;
- lê ou grava dados de usuário, especialmente dados sensíveis;
- aceita upload de arquivo;
- integra serviço externo (email, pagamento, storage, webhook);
- adiciona ou altera tabela em banco de dados (Prisma migration ou tabela
  Supabase — neste último caso, RLS é sempre parte da revisão).

Features puramente de UI sem novo fluxo de dados podem pular `/security` a
critério do desenvolvedor, mas isso deve ser explicitado no `code-review.md`
da feature.

## Checklist coberto (ver skill `security` para o detalhe acionável)

- Autenticação e gestão de sessão
- Autorização, RBAC e checagem de ownership (IDOR)
- SQL Injection (queries parametrizadas / ORM sem raw SQL não sanitizado)
- XSS (escaping, `dangerouslySetInnerHTML`, sanitização de HTML de usuário)
- CSRF (proteção em mutações, same-site cookies)
- SSRF (validação de URLs fornecidas por usuário antes de fetch server-side)
- Validação de entrada com Zod em toda borda (API, forms, webhooks)
- Rate limiting em rotas sensíveis (login, reset de senha, APIs públicas)
- CORS restritivo (allowlist explícita, nunca `*` com credenciais)
- Headers de segurança (CSP, HSTS, X-Content-Type-Options, etc.)
- Gestão de secrets (nunca em código-fonte, sempre via env vars/secret
  manager, nunca logados)
- Upload de arquivos (validação de tipo/tamanho, scanning quando aplicável,
  storage fora do webroot público)
- Exposição de dados (nunca retornar campos sensíveis não solicitados,
  paginação sem vazar contagens sensíveis)
- Logs (nunca logar senha, token, PII sem necessidade e sem retenção
  definida)
- Dependências vulneráveis (`npm audit` / Dependabot / Renovate no CI)
- Segurança de API (autenticação em toda rota, versionamento, output
  encoding)
- Segurança de banco de dados (least privilege na connection string,
  migrations revisadas, backups)
- **RLS no Supabase**: toda tabela exposta ao client via
  `supabase-js`/PostgREST deve ter RLS habilitada; nenhuma tabela fica
  acessível por padrão sem policy explícita (ver
  `.claude/skills/security/references/supabase-rls.md`)
- Path Traversal, Command Injection, JWT/tokens, mass assignment, HTTP
  parameter pollution, webhooks recebidos e configuração de produção (ver
  `references/injection.md`, `references/auth-authz.md`,
  `references/api-security.md`, `references/data-secrets-logging.md`)

Itens de nível produto/organização (MFA para admin, backups testados,
resposta a incidente, rotação de chave, LGPD, pentest) estão em
`.claude/skills/security/references/saas-hardening-checklist.md` — não são
parte do checklist por-feature, mas devem ser revisados antes de um
lançamento importante.

## Divulgação de vulnerabilidades

Este é um workspace pessoal de template, não um produto com usuários
externos. Ainda assim, se este repositório for publicado e alguém
identificar um problema de segurança nos templates/skills (ex.: um exemplo
que ensina padrão inseguro), abra uma issue ou contate diretamente o
mantenedor antes de divulgar publicamente.

## Segurança dentro deste próprio workspace

- Nenhum arquivo de exemplo (`templates/**/.env.example`) deve conter
  segredo real — apenas placeholders.
- Nenhuma skill deve recomendar desabilitar verificação de tipo, lint de
  segurança ou RLS "para simplificar".
- Exemplos de código em `templates/` e `skills/` priorizam o padrão seguro
  mesmo quando mais verboso.

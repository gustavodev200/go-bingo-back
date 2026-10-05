---
name: security
description: Use em toda feature que toca autenticação, autorização, entrada de usuário, dados sensíveis, upload de arquivo ou integração externa — e sempre na fase Security Review (/security) do SpecKit. Índice do checklist de segurança do workspace; preset-agnóstica, com referência específica para RLS no Supabase.
---

# Security

Índice do checklist de segurança deste workspace. Cada tópico tem um
arquivo de referência com o detalhe acionável — carregue apenas o(s)
relevante(s) para a feature em questão, para não inchar o contexto.

## Quando usar

- Sempre que a feature: cria/altera autenticação ou sessão; expõe rota de
  API/Server Action; lê ou grava dado de usuário; aceita upload; integra
  serviço externo; cria ou altera tabela de banco.
- Sempre na fase **Security Review** (`/security`) do fluxo SpecKit, antes
  do Code Review.

Ver [SECURITY.md](../../../SECURITY.md) na raiz do workspace para a política
completa e quando a fase é obrigatória.

## Índice de referências

Checklists por tópico (a "matéria-prima" — o que verificar):

| Arquivo | Cobre |
|---|---|
| `references/auth-authz.md` | Autenticação, hashing de senha, JWT/tokens, RBAC, IDOR |
| `references/injection.md` | SQL Injection, XSS, CSRF, SSRF, Path Traversal, Command Injection |
| `references/api-security.md` | Rate limiting, CORS, headers, mass assignment, HTTP parameter pollution, webhooks |
| `references/data-secrets-logging.md` | Secrets, exposição de dados, logs, dependências vulneráveis, configuração de produção |
| `references/file-uploads.md` | Upload de arquivos |
| `references/supabase-rls.md` | RLS no Supabase (obrigatório em toda tabela exposta) |

Processos — quando e como aplicar os checklists acima:

| Arquivo | Quando usar |
|---|---|
| `references/pre-deploy-gate.md` | Toda vez que uma feature/correção termina, antes do deploy — é o processo por trás do comando `/security`. Termina num Security Gate PASS/PASS WITH WARNINGS/FAIL. |
| `references/full-audit.md` | Auditoria periódica de toda a aplicação (não uma feature) — comando `/security-audit`. Inclui reconhecimento de superfície de ataque, business logic, infra, e mapeamento OWASP ASVS/API Top 10 completo. |
| `references/saas-hardening-checklist.md` | Checklist de produto/organização (MFA, backups, LGPD, resposta a incidente, rotação de chave, pentest) — itens que não são "código de uma feature", mas maturidade do SaaS como um todo. |

Validação de entrada com Zod é tratada na skill `frontend/zod` (é regra de
todo dado externo, não só de segurança) — referenciada aqui, não duplicada.

## Ferramenta automatizada opcional

Uma ferramenta de SAST (ex.: [Semgrep](https://github.com/semgrep/semgrep),
`semgrep --config auto .`) pode rodar como primeira passada antes da
análise manual — útil para pegar padrão óbvio rápido, mas não substitui as
fases manuais (IDOR, RLS, business logic não são detectáveis por SAST
genérico). Ver `references/full-audit.md`.

## Como aplicar durante `/security`

1. Releia o `spec.md` e `plan.md` da feature para saber que dado, rota e
   tabela estão envolvidos.
2. Siga `references/pre-deploy-gate.md` — ele indica quais checklists por
   tópico carregar (nem sempre todos se aplicam) e o formato de achado e
   de gate final.
3. Preencha `.specify/templates/security-review-template.md` marcando cada
   item como aplicável/não-aplicável/pendente, com nota do porquê.
4. Qualquer item "pendente" bloqueia a fase Code Review até ser resolvido
   ou explicitamente aceito como risco pelo usuário.

Para auditoria de toda a plataforma (não uma feature), use `/security-audit`
e `references/full-audit.md` em vez deste fluxo por-feature.

## Princípio geral

Defesa em profundidade: validação de entrada (Zod) + autorização explícita
no backend/service + RLS (quando Supabase) são camadas independentes — a
ausência de uma não deve ser compensada silenciosamente assumindo que outra
"já cobre".

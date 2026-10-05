# Security Review: [Nome da Feature]

- **Plan relacionado**: `plan.md`
- **Status**: [Pendente | Aprovado | Aprovado com ressalvas | Bloqueado]

Siga o processo em `.claude/skills/security/references/pre-deploy-gate.md`
(escopo da alteração + blast radius, "não confie no frontend", checklist
por tópico, evidência, severidade, gate final). Preencha usando as
referências relevantes de `.claude/skills/security/references/`. Todo item
"Pendente" bloqueia o Code Review até virar Aprovado ou ser aceito como
risco explícito pelo usuário (registrado na seção final).

## Escopo da alteração

- Feature/correção: [...]
- Arquivos/componentes/endpoints/serviços/tabelas afetados: [...]
- Blast radius (outros consumidores de um service/função alterado): [...]

## Achados

Um bloco por achado, usando o formato de `pre-deploy-gate.md`:

```text
Vulnerabilidade:
Severidade: [CRITICAL | HIGH | MEDIUM | LOW | INFORMATIONAL]
Arquivo:
Linha:
Componente/Endpoint:
Evidência: [CONFIRMADO | PROVÁVEL | POSSÍVEL | NÃO REPRODUZIDO | FALSE POSITIVE]
Como pode ser explorada:
Impacto:
Correção recomendada:
Como validar a correção:
```

## Checklist por tópico (marcar Aplicável / Não aplicável / Pendente / Resolvido)

### Autenticação e Autorização (`references/auth-authz.md`)

- [ ] [item] — [status] — [nota]

### Injection: SQLi, XSS, CSRF, SSRF, Path Traversal, Command Injection (`references/injection.md`)

- [ ] [item] — [status] — [nota]

### API: Rate limiting, CORS, Headers, Mass Assignment, Webhooks (`references/api-security.md`)

- [ ] [item] — [status] — [nota]

### Secrets, Exposição de Dados, Logs, Dependências, Config de Produção (`references/data-secrets-logging.md`)

- [ ] [item] — [status] — [nota]

### Upload de Arquivos (`references/file-uploads.md`)

[Preencher só se a feature envolve upload.]

- [ ] [item] — [status] — [nota]

### RLS no Supabase (`references/supabase-rls.md`)

[Preencher só se preset = supabase e a feature cria/altera tabela.]

- [ ] [item] — [status] — [nota]

## Riscos aceitos explicitamente

[Qualquer item "Pendente" que o usuário decidiu aceitar como risco em vez
de corrigir agora — com o motivo e quem aprovou.]

## Security Gate

```text
Status: PASS / PASS WITH WARNINGS / FAIL

CRITICAL: 0
HIGH: 0
MEDIUM: X
LOW: X
INFORMATIONAL: X
```

- **PASS**: `CRITICAL = 0` e `HIGH = 0`, sem risco relevante sem
  justificativa — pronto para `/review`.
- **PASS WITH WARNINGS**: nada crítico/alto, mas há hardening pendente
  registrado em "Riscos aceitos explicitamente".
- **FAIL**: bloqueado — liste exatamente o que falta corrigir antes de
  seguir para `/review`.

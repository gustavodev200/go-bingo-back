# Security Gate — Pré-Deploy / Por Feature

Processo a rodar **sempre que uma feature, correção ou refatoração for
finalizada, antes de ir para produção** — é o processo por trás do comando
`/security` (fase Security Review do SpecKit) e deve ser repetido
manualmente antes de qualquer deploy que não passou pelo fluxo completo.

Referências: OWASP Top 10, OWASP ASVS, OWASP API Security Top 10, Secure
Coding Practices, princípio de menor privilégio, defense in depth.

O objetivo não é revisar só os arquivos alterados — é avaliar a feature
**e tudo que ela afeta** (endpoints, serviços, tabelas, autenticação,
autorização, dependências).

## 1. Escopo da alteração

Antes de auditar, identifique:

- Feature/correção implementada, arquivos modificados, componentes
  criados.
- Endpoints criados ou alterados; serviços modificados; tabelas/models
  alterados; permissões alteradas.
- Dados novos recebidos ou armazenados; dependências adicionadas ou
  atualizadas; integrações externas alteradas.

Trace o fluxo completo, não só o ponto de entrada:

```
Frontend → API/Server Action → Controller/Handler → Service → ORM/Query → Database
```

E, se houver auth envolvida:

```
Usuário → Authentication → Authorization → Resource
```

### Blast radius (não pule esta parte)

Se a feature alterou um service/função compartilhada, liste **todos os
outros consumidores** desse service/função e reavalie cada um — uma
mudança num método usado por 5 endpoints exige reavaliar os 5, não só o
que motivou a mudança.

## 2. Não confie no frontend

Nenhuma regra de segurança (permissão, role, ownership, preço, status,
acesso a página) pode estar aplicada só no frontend. Teste mentalmente:

> Se um usuário ignorar completamente o frontend e chamar a API
> diretamente, ele ainda consegue executar só o que tem permissão para
> executar?

Se a resposta for não, é vulnerabilidade — classifique e registre.

## 3. Checklist por tópico (carregue só o que se aplica)

| Tópico | Arquivo |
|---|---|
| Autenticação, hashing de senha, JWT, RBAC, IDOR | `auth-authz.md` |
| SQL Injection, XSS, CSRF, SSRF, Path Traversal, Command Injection | `injection.md` |
| Rate limiting, CORS, headers, mass assignment, HTTP parameter pollution, webhooks | `api-security.md` |
| Secrets, exposição de dados, logs, dependências, config de produção | `data-secrets-logging.md` |
| Upload de arquivos | `file-uploads.md` |
| RLS no Supabase | `supabase-rls.md` (obrigatório se preset `supabase` e a feature toca tabela) |

Para cada item aplicável, teste ativamente — não apenas leia o código
assumindo que "parece certo". Onde fizer sentido, teste o cenário adversarial
(IDOR: trocar o ID do recurso; mass assignment: enviar campo extra;
autorização: chamar o endpoint com role menor).

## 4. Evidência — não invente vulnerabilidade

Classifique cada achado como um destes, nunca genericamente "pode ser
problema":

```
CONFIRMADO       — reproduzido ou claramente demonstrável pelo código
PROVÁVEL         — padrão de código indica o problema, não totalmente testado
POSSÍVEL         — hipótese razoável, precisa de mais investigação
NÃO REPRODUZIDO  — tentado e não confirmado
FALSE POSITIVE   — parecia problema, mas não é (explique por quê)
```

Não altere código automaticamente só para eliminar um alerta — primeiro
explique o problema e a correção recomendada, então corrija.

## 5. Formato de cada achado

```
Vulnerabilidade:
Severidade:
Arquivo:
Linha:
Componente/Endpoint:
Evidência:
Como pode ser explorada:
Impacto:
Correção recomendada:
Como validar a correção:
```

## 6. Severidade

- **CRITICAL** — takeover de conta, RCE, acesso generalizado ao banco,
  exposição massiva de dados, bypass completo de auth/authz,
  comprometimento de infraestrutura. **Bloqueia deploy.**
- **HIGH** — falha grave com impacto significativo. Corrigir antes do
  deploy.
- **MEDIUM** — impacto moderado ou exploração condicional. Corrigir antes
  ou logo após o deploy, conforme risco.
- **LOW** — baixo impacto ou hardening. Registrar para melhoria.
- **INFORMATIONAL** — observação/recomendação sem vulnerabilidade
  comprovada.

## 7. Security Gate (bloco final obrigatório)

```
Status: PASS / PASS WITH WARNINGS / FAIL

CRITICAL: 0
HIGH: 0
MEDIUM: X
LOW: X
INFORMATIONAL: X
```

- **PASS**: `CRITICAL = 0` e `HIGH = 0`, sem risco relevante sem
  justificativa.
- **PASS WITH WARNINGS**: nada crítico/alto, mas há recomendações de
  hardening ou riscos menores pendentes.
- **FAIL**: `CRITICAL > 0`, ou HIGH claramente explorável — não fazer
  deploy até corrigir. Explique exatamente o que falta corrigir.

Preencha `.specify/templates/security-review-template.md` com este formato
para a feature em questão.

## Regra final

Testes passando, TypeScript compilando e lint verde **não significam que a
feature é segura**. Faça a pergunta adversarial:

> Se eu fosse um usuário malicioso tentando abusar exatamente desta
> feature, como eu tentaria quebrá-la?

Não feche a revisão sem ter considerado: bypass de autenticação, bypass de
autorização, acesso/alteração de dado de outro usuário, injeção, execução
de código, exposição de secrets, abuso de API, upload malicioso, vazamento
de informação.

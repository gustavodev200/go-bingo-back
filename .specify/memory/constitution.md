# Workspace Agents — Base Constitution

Princípios fixos herdados por todo projeto criado a partir deste workspace.
Lida como gate pelo `/speckit-plan` oficial (seção "Constitution Check") —
uma feature cujo plano viole um destes princípios deve justificar a exceção
em "Complexity Tracking" do `plan.md`, não ignorar silenciosamente.

Um projeto concreto pode **adicionar** princípios próprios rodando
`/speckit-constitution` (preserva o conteúdo abaixo e anexa o que for
específico do produto), mas não deve contradizer os princípios herdados
sem registrar explicitamente a exceção e o motivo.

## Core Principles

### I. Stack Declarada, Não Assumida

O preset ativo vem sempre de `project.config.json` (`prisma-postgres` ou
`supabase`), nunca de suposição. Nenhuma feature assume Prisma num projeto
Supabase ou vice-versa. Antes de `/speckit-plan` preencher "Technical
Context", leia `project.config.json` e a skill `core/stack-detection` para
saber quais skills de stack são elegíveis.

### II. Zod na Borda, Sempre

Toda entrada externa (form, API, webhook, query param) é validada com Zod
antes de tocar lógica de negócio, nos dois presets. Não-negociável: não
existe caminho de dado externo que pule essa validação por conveniência.

### III. Autorização Explícita no Servidor

Sessão válida não é autorização. Toda ação sensível verifica, no servidor,
se o usuário pode especificamente fazer aquilo (ownership/RBAC). No preset
Supabase isso é reforçado por RLS (Princípio IV); no preset Prisma é código
explícito no service. Esconder algo no frontend nunca conta como proteção.

### IV. RLS Obrigatória em Tabelas Supabase

Toda tabela exposta via `supabase-js`/PostgREST tem Row Level Security
habilitada com policy explícita, criada na mesma migration que cria a
tabela. Uma tabela sem policy fica bloqueada por padrão — isso é o estado
correto, não um bug a "destravar" com `USING (true)` por conveniência.

### V. Segurança Antes do Code Review

O comando `/security` (Security Gate — ver
`.claude/skills/security/references/pre-deploy-gate.md`) roda antes do
`/review` sempre que a feature tocar autenticação, dado de usuário, upload
ou integração externa. Achados CRITICAL ou HIGH pendentes bloqueiam a
aprovação final (`/review` não pode declarar Aprovado com Gate em FAIL).

### VI. YAGNI

Nenhuma abstração, flag, camada ou dependência é adicionada para caso
hipotético — nem em código de projeto, nem em mudanças neste próprio
workspace-template. Complexidade nova precisa de justificativa real,
registrada em "Complexity Tracking" do `plan.md` quando aplicável.

### VII. Rastreabilidade Spec → Review

Toda feature de porte médio+ produz, em `specs/<NNN>-<slug>/`: `spec.md`
(`/speckit-specify`, com clarificações incorporadas na própria seção
`## Clarifications` via `/speckit-clarify` — não um arquivo separado),
`plan.md` (`/speckit-plan`), `tasks.md` (`/speckit-tasks`), e, quando
aplicável, `security-review.md` (`/security`) e `code-review.md`
(`/review`).

### VIII. Cobertura de Testes Unitários Obrigatória

Todo código de lógica (services, regras puras, reducers/stores, hooks,
`lib/`) tem teste unitário antes de ser considerado concluído — não é
responsabilidade só do `/test` depois do fato, é parte do próprio
`/speckit-implement` (TDD: teste antes do código, ver `tdd` skill). CI
roda a suíte com `--coverage` e falha a build abaixo de **80% de
statements/branches/functions/lines**, medidos sobre `src/` excluindo
código gerado (`src/generated/`, `src/contracts/` no projeto que só
recebe o contrato por `contracts:sync`) e arquivos de configuração sem
lógica. Testes end-to-end/integração (ex.: `test/*.e2e-spec.ts` no
Preset A) complementam a cobertura unitária mas não a substituem — uma
regra de negócio sem teste unitário próprio, só coberta por um e2e, é
dívida a ser registrada, não a meta. Uma feature cujo `plan.md` não
reserva tempo para isso, ou cujo PR reduz a cobertura abaixo do limiar,
bloqueia em `/review` (Princípio V estende-se a cobertura, não só a
achados de segurança).

## Integração com o Spec-Kit Oficial

Este workspace usa o [spec-kit](https://github.com/github/spec-kit) oficial
como motor do fluxo Specification → Clarification → Plan → Tasks →
Implementation (`/speckit-specify`, `/speckit-clarify`, `/speckit-plan`,
`/speckit-tasks`, `/speckit-implement`, mais os opcionais
`/speckit-analyze`, `/speckit-checklist`, `/speckit-converge`). Os comandos
`/test`, `/security`, `/security-audit`, `/review` e `/seo` são específicos
deste workspace e rodam **depois** de `/speckit-implement` — não têm
equivalente oficial. Nunca edite os templates em `.specify/templates/`
esperando que sobrevivam a um `specify self upgrade`; customizações de
fluxo pertencem a este arquivo (lido como contexto por todos os comandos
oficiais) ou aos comandos/skills próprios deste workspace.

## Como um Projeto Estende Isto

Rode `/speckit-constitution` no projeto novo para anexar princípios
específicos do produto (ex.: "toda feature de billing passa por revisão do
responsável financeiro") — o comando preserva os princípios herdados acima
e adiciona os novos. Não remova um princípio herdado; se ele não se aplica,
registre a exceção explicitamente com o motivo em vez de apagá-lo.

## Governance

Este documento tem precedência sobre convenção de código ou preferência
individual dentro do escopo de um projeto gerado a partir deste workspace.
Emenda requer: descrição da mudança, incremento de versão semântica
(MAJOR = remoção/redefinição incompatível de princípio; MINOR = princípio
novo ou seção expandida; PATCH = redação/clarificação) e atualização da
data de "Last Amended" abaixo. `/speckit-plan` deve recusar avançar se o
"Constitution Check" apontar violação não justificada.

**Version**: 1.1.0 | **Ratified**: 2026-09-08 | **Last Amended**: 2026-10-05

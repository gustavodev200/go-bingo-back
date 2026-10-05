# workspace-agents

Workspace/template pessoal para desenvolvimento de software com agentes de
IA — Claude Code + o [spec-kit](https://github.com/github/spec-kit) oficial
(`specify-cli`), já instalado neste workspace via `specify init --here`.
Não é uma aplicação — é a base reutilizável que você copia para iniciar
cada novo projeto com o motor de spec-kit, skills, comandos, templates e
regras de segurança já prontos.

## Índice

- [O que tem aqui](#o-que-tem-aqui)
- [Como criar um novo projeto a partir do template](#como-criar-um-novo-projeto-a-partir-do-template)
- [Escolhendo o preset (Prisma/PostgreSQL vs Supabase)](#escolhendo-o-preset)
- [Como as skills condicionais funcionam](#como-as-skills-condicionais-funcionam)
- [Como o Claude Code identifica a stack](#como-o-claude-code-identifica-a-stack)
- [Usando o SpecKit](#usando-o-speckit)
- [Adicionando uma nova stack](#adicionando-uma-nova-stack)
- [Arquivos a personalizar por projeto](#arquivos-a-personalizar-por-projeto)

## O que tem aqui

```
.claude/skills/speckit-*/  → motor oficial do spec-kit (specify, clarify, plan, tasks, implement, analyze, checklist, converge) — não editar
.claude/skills/            → skills próprias por domínio (frontend, backend, database, prisma, supabase, security, seo, testing, performance, code-review)
.claude/commands/          → comandos próprios (/test, /security, /security-audit, /review, /seo) — rodam depois de /speckit-implement
.specify/memory/           → princípios fixos (constitution.md) — lido como gate pelo /speckit-plan
.specify/templates/        → templates oficiais (spec, plan, tasks, constitution, checklist) + próprios (security-review, code-review)
.specify/scripts/          → scripts do spec-kit (numeração de feature, etc.) — não editar
templates/                 → scaffolds de referência por stack (não são apps prontas)
CLAUDE.md                  → contrato raiz para o agente
SECURITY.md                → checklist e política de segurança do workspace
CONTRIBUTING.md            → como estender isto
```

## Como criar um novo projeto a partir do template

1. Copie esta pasta para o diretório do novo projeto (ou use-a como template
   de repositório Git — `git clone`/`degit`/copiar manualmente).
2. Escolha o preset e copie o arquivo de config correspondente:
   ```bash
   # Preset A — Prisma/PostgreSQL
   cp project.config.example.json project.config.json

   # Preset B — Supabase
   cp project.config.supabase.example.json project.config.json
   ```
3. Ajuste os campos de `project.config.json` (nome do projeto, storage,
   auth, etc. — veja a seção abaixo).
4. Rode `/speckit-specify` no Claude Code para começar a especificar a
   primeira feature. O agente vai ler `project.config.json` automaticamente
   antes de qualquer outra coisa (via `CLAUDE.md`/`constitution.md`).

Não há script de bootstrap próprio além do que o spec-kit já traz — o
processo é copiar a pasta + editar um JSON, já simples o suficiente. Não é
necessário rodar `specify init` de novo: o motor do spec-kit já está
instalado neste workspace-template e é copiado junto.

## Escolhendo o preset

`project.config.json` tem um campo `preset` com dois valores suportados:

| `preset` | Frontend | Backend/Database |
|---|---|---|
| `"prisma-postgres"` | Next.js, shadcn/ui, Tailwind, Zod, Better Auth, Zustand, Resend | NestJS, Prisma, PostgreSQL, Zod, Resend |
| `"supabase"` | Next.js, shadcn/ui, Tailwind, Zod, Zustand, Resend | Supabase (PostgreSQL, Auth quando definido, Storage quando necessário, RLS) |

Campos individuais (`frontend`, `backend`, `database`, `auth`, `email`,
`storage`) permitem desvios pontuais sem trocar o preset inteiro — por
exemplo, um projeto Supabase que ainda assim usa Better Auth por cima. Nesse
caso, deixe explícito no `project.config.json` e cite a exceção na
`constitution.md` do projeto.

## Como as skills condicionais funcionam

Cada skill de stack tem, no frontmatter do seu `SKILL.md`, uma descrição que
já declara para qual preset ela vale. Exemplo (`prisma/SKILL.md`):

```yaml
description: Use apenas quando project.config.json tiver preset "prisma-postgres" ou database "prisma-postgres". Não usar em projetos Supabase.
```

O agente (via `.claude/skills/core/stack-detection/SKILL.md`, que é sempre a
primeira skill considerada em qualquer tarefa) lê `project.config.json` e
filtra: se o preset é `supabase`, a skill `prisma/` nunca é carregada, e
vice-versa. Skills preset-agnósticas (`frontend/*`, `database/postgresql`,
`security/*`, `testing`, `performance`, `code-review`) são sempre elegíveis.

Isso mantém as skills independentes: você pode editar `prisma/SKILL.md` sem
nunca tocar em `supabase/SKILL.md`, e um projeto Supabase nunca vê conteúdo
de Prisma no contexto do agente.

## Como o Claude Code identifica a stack

1. `CLAUDE.md` na raiz instrui o agente a ler `project.config.json` antes de
   qualquer ação.
2. A skill `core/stack-detection` documenta o algoritmo de leitura e
   mapeamento preset → skills elegíveis.
3. `.specify/memory/constitution.md` (Princípio I) reforça a mesma regra —
   é lido como contexto por todos os comandos oficiais do spec-kit
   (`/speckit-specify`, `/speckit-clarify`, `/speckit-plan`,
   `/speckit-tasks`, `/speckit-implement`) e pelos comandos próprios
   (`/test`, `/security`, `/security-audit`, `/review`, `/seo`), mesmo se
   invocado fora de uma sessão que já carregou o `CLAUDE.md` (ex.:
   subagentes).

Se `project.config.json` não existir, o agente trata o diretório como o
próprio workspace-template (não gera código de projeto) ou avisa que a
configuração está faltando.

## Usando o SpecKit

Fluxo completo — as 5 primeiras fases usam o **motor oficial do
[spec-kit](https://github.com/github/spec-kit)** (instalado neste workspace
via `specify init --here`, skills `speckit-*`); as 3 últimas são comandos
próprios deste workspace:

```
Specification → Clarification → Plan → Tasks → Implementation → Tests → Security Review → Code Review
```

Comandos e templates correspondentes:

| Fase | Comando | Origem | Template |
|---|---|---|---|
| Specification | `/speckit-specify` | oficial | `.specify/templates/spec-template.md` |
| Clarification | `/speckit-clarify` | oficial | escreve direto na seção `## Clarifications` do `spec.md` (sem template próprio) |
| Plan | `/speckit-plan` | oficial | `.specify/templates/plan-template.md` |
| Tasks | `/speckit-tasks` | oficial | `.specify/templates/tasks-template.md` |
| Implementation | `/speckit-implement` | oficial | segue `tasks.md` gerado |
| Tests | `/test` | workspace | segue skill `testing` |
| Security Review | `/security` | workspace | `.specify/templates/security-review-template.md` |
| Code Review | `/review` | workspace | `.specify/templates/code-review-template.md` |

Opcionais do spec-kit oficial, use quando fizer sentido: `/speckit-analyze`
(consistência cruzada entre spec/plan/tasks, depois de `/speckit-tasks` e
antes de `/speckit-implement`), `/speckit-checklist` (checklist de
qualidade da spec, depois de `/speckit-plan`), `/speckit-converge`
(varre um codebase existente e gera tasks do que falta — útil ao adotar
este workspace num projeto já em andamento).

Cada fase grava seu artefato em `specs/<NNN>-<slug>/` no projeto (spec.md
com clarificações embutidas, plan.md, tasks.md, security-review.md,
code-review.md), na mesma pasta, para manter rastreabilidade completa de
uma feature do início ao fim — convenção de numeração e diretório definida
pelos scripts do spec-kit em `.specify/scripts/`, idêntica à que este
workspace já usava. Nunca edite `.specify/templates/{spec,plan,tasks,
constitution,checklist}-template.md` diretamente — não sobrevivem a um
`specify self upgrade`; customização de regra vai em
`.specify/memory/constitution.md`, que `/speckit-plan` lê como gate
("Constitution Check").

`/security` roda o Security Gate por feature (processo em
`.claude/skills/security/references/pre-deploy-gate.md`) e termina num
status `PASS` / `PASS WITH WARNINGS` / `FAIL`.

### Auditoria completa (fora do fluxo por feature)

Além das 8 fases acima, existe `/security-audit`: audita **toda a
plataforma** (não uma feature), seguindo OWASP WSTG/ASVS/API Security Top
10 — ver `.claude/skills/security/references/full-audit.md`. Use antes de
um marco importante (lançamento, cliente enterprise) ou em revisão
periódica; salva o relatório em `security-audits/<data>-full-audit.md` no
projeto. Não faz correção de código sozinho — só relatório, até você
autorizar.

Para itens de nível produto/organização que nenhum dos dois comandos cobre
(MFA para admin, backups testados, resposta a incidente, rotação de
chaves, LGPD, pentest externo), use
`.claude/skills/security/references/saas-hardening-checklist.md`
manualmente.

Também fora do fluxo por feature: `/seo` audita e implementa melhorias de
SEO, indexação, `llms.txt`/AI-GEO e conteúdo de conversão (FAQ, cases,
página de posicionamento) das páginas públicas — ver skill `seo`. Nunca
inventa cliente, depoimento ou métrica; sem dado real, cria só a estrutura
vazia. Relatório salvo em `seo-audits/<data>-seo-report.md` no projeto.

## Adicionando uma nova stack

Ver [CONTRIBUTING.md](CONTRIBUTING.md#adicionando-uma-nova-stack) para o
passo a passo (nova skill + entrada no `stack-detection` + template em
`templates/`, se aplicável).

## Arquivos a personalizar por projeto

Ao usar este template num projeto novo, edite apenas:

- `project.config.json` — criado a partir do exemplo do preset escolhido.
- `.specify/memory/constitution.md` — rode `/speckit-constitution` para
  anexar princípios específicos do projeto, mantendo os herdados.
- README do próprio projeto (diferente deste, que descreve o template).
- `.env` / `.env.local` do projeto, a partir dos `.env.example` em
  `templates/<stack>/`.

Não é necessário editar `.claude/skills/`, `.claude/commands/` ou
`.specify/templates/` — eles são compartilhados entre todos os projetos que
usam este workspace, a menos que você esteja adicionando uma stack nova.

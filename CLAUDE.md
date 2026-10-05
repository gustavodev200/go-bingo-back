# CLAUDE.md — Workspace de Desenvolvimento com Agentes de IA

Este repositório é um **workspace/template pessoal**. Ele não é uma aplicação
de negócio: não contém funcionalidades de produto, apenas estrutura,
configuração, skills, comandos, templates e regras reutilizáveis para iniciar
e conduzir projetos de software com Claude Code + o [spec-kit](https://github.com/github/spec-kit)
oficial (github/spec-kit), instalado neste workspace via `specify init --here`.

## Regra #1 — sempre ler `project.config.json` primeiro

Antes de aplicar qualquer skill condicional (Prisma, Supabase, NestJS, etc.)
ou executar qualquer comando (`/speckit-specify`, `/speckit-clarify`,
`/speckit-plan`, `/speckit-tasks`, `/speckit-implement`, `/test`,
`/security`, `/security-audit`, `/review`, `/seo`), leia o arquivo
`project.config.json` na raiz do projeto atual.

- Se o arquivo **não existir**, este diretório ainda é o workspace-template
  (não um projeto concreto) ou o projeto ainda não foi configurado — avise o
  usuário e sugira copiar `project.config.example.json` (preset Prisma/PostgreSQL)
  ou `project.config.supabase.example.json` (preset Supabase) para
  `project.config.json`.
- Se existir, leia o campo `preset` e use-o para decidir quais skills
  carregar. Veja `.claude/skills/core/stack-detection/SKILL.md` para o
  algoritmo completo.

Regra prática: **nunca** carregue a skill `prisma` num projeto com
`preset: "supabase"`, e vice-versa. Skills de `frontend/`, `security/`,
`seo/`, `testing/`, `performance/` e `code-review/` são preset-agnósticas e
sempre podem ser usadas.

## Stack padrão

### Preset A — Prisma / PostgreSQL

```
Frontend: Next.js, shadcn/ui, Tailwind CSS, Zod, Better Auth, Zustand, Resend
Backend:  NestJS, Prisma ORM, PostgreSQL, Zod, Resend
```

### Preset B — Supabase

```
Frontend: Next.js, shadcn/ui, Tailwind CSS, Zod, Zustand, Resend
Backend:  Supabase (PostgreSQL + Auth quando definido + Storage quando necessário + RLS)
```

Nenhum dos dois é obrigatório para todo projeto — são os dois presets
suportados nativamente. Novas stacks podem ser adicionadas seguindo
[CONTRIBUTING.md](CONTRIBUTING.md).

## Onde estão as coisas

| Caminho | Responsabilidade |
|---|---|
| `.claude/skills/speckit-*/` | Motor oficial do spec-kit (`speckit-specify`, `speckit-clarify`, `speckit-plan`, `speckit-tasks`, `speckit-implement`, `speckit-analyze`, `speckit-checklist`, `speckit-converge`) — não editar, vem do pacote `specify-cli`. |
| `.claude/skills/{core,frontend,backend,database,prisma,supabase,security,seo,testing,performance,code-review}/` | Skills próprias deste workspace, organizadas por domínio, carregadas condicionalmente conforme o preset. |
| `.claude/commands/` | Comandos próprios deste workspace (`/test`, `/security`, `/security-audit`, `/review`, `/seo`) que rodam **depois** de `/speckit-implement` — sem equivalente oficial no spec-kit. |
| `.specify/memory/constitution.md` | Princípios fixos de engenharia que todo projeto herda — lido como gate pelo `/speckit-plan` oficial. |
| `.specify/templates/{spec,plan,tasks,constitution,checklist}-template.md` | Templates oficiais do spec-kit (não editar diretamente — não sobrevivem a `specify self upgrade`; customização vai em `constitution.md`). |
| `.specify/templates/{security-review,code-review}-template.md` | Templates próprios deste workspace, para os comandos `/security` e `/review`. |
| `.specify/scripts/` | Scripts do spec-kit (numeração de feature, criação de diretório `specs/NNN-slug/`, prerequisites) — não editar. |
| `templates/` | Scaffolds de referência por stack (Next.js, Prisma+Postgres, Supabase, wiring fullstack). São exemplos/documentação, não aplicações prontas. |
| `SECURITY.md` | Checklist de segurança do workspace e política de divulgação. |
| `CONTRIBUTING.md` | Como adicionar/editar skills, comandos e templates. |

## Fluxo SpecKit

```
Specification → Clarification → Plan → Tasks → Implementation → Tests → Security Review → Code Review
   /speckit-specify  /speckit-clarify  /speckit-plan  /speckit-tasks  /speckit-implement  /test  /security  /review
```

As primeiras 5 fases usam o motor oficial do spec-kit (skills `speckit-*`,
instaladas via `specify` CLI); `/test`, `/security` e `/review` são
comandos próprios deste workspace. Veja a seção "SpecKit" do
[README.md](README.md) para o guia completo de uso.

## Princípios gerais para o agente

1. **YAGNI sempre.** Não adicionar abstrações, flags ou configuração para
   casos hipotéticos. Isso vale tanto para código gerado em projetos quanto
   para mudanças neste próprio workspace.
2. **Modularidade por preset.** Uma skill de banco de dados nunca deve
   assumir Prisma ou Supabase ao mesmo tempo — cada uma vive no seu diretório
   e é carregada de forma condicional.
3. **Segurança não é opcional.** Toda feature que toca autenticação,
   autorização, entrada de usuário, upload de arquivo ou dados sensíveis deve
   passar pela skill `security` e pelo comando `/security` antes do `/review`
   final — ver Princípio V do `.specify/memory/constitution.md`.
4. **Zod na borda.** Toda entrada externa (formulário, API, webhook) é
   validada com Zod antes de tocar lógica de negócio — em ambos os presets.
5. **Sem funcionalidade de negócio neste repositório.** Mudanças aqui são
   sempre sobre estrutura, skills, comandos, templates, segurança e
   automações reutilizáveis — nunca sobre um produto específico.
6. **Não editar o motor do spec-kit.** `.claude/skills/speckit-*/`,
   `.specify/scripts/` e `.specify/templates/{spec,plan,tasks,constitution,
   checklist}-template.md` vêm do pacote `specify-cli` — customização de
   fluxo vai em `.specify/memory/constitution.md`, não nesses arquivos.

## Personalização por projeto

Ao clonar/copiar este workspace para um novo projeto, os únicos arquivos que
precisam ser editados são:

- `project.config.json` (criado a partir do exemplo do preset escolhido)
- `.specify/memory/constitution.md` (rode `/speckit-constitution` para
  anexar princípios específicos do projeto, sem apagar os herdados)
- README do projeto (este README.md descreve o workspace-template, não o
  produto final)

Tudo em `.claude/skills/`, `.claude/commands/` e `.specify/templates/` é
reutilizado sem alteração entre projetos, salvo necessidade de nova stack
ou upgrade do próprio spec-kit (`specify self upgrade`).

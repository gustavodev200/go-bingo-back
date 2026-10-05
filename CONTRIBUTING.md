# Contribuindo com este workspace

Guia para estender o workspace: adicionar skills, comandos, templates ou uma
stack inteiramente nova.

## Princípios ao editar este repositório

- Este repositório **não** contém funcionalidade de produto. Toda mudança é
  estrutura, skill, comando, template, regra ou documentação.
- Skills de stack (`prisma/`, `supabase/`, `backend/nestjs/`, etc.) devem
  permanecer independentes: uma nunca deve pressupor a existência da outra.
- YAGNI: não crie skill, comando ou template para uma stack que você ainda
  não usa de verdade.

## Adicionando uma nova skill

1. Escolha o diretório de domínio certo em `.claude/skills/` (`core`,
   `frontend`, `backend`, `database`, `security`, `seo`, `testing`,
   `performance`, `code-review`) ou crie um novo domínio de topo se nenhum
   couber. Nunca crie nada dentro de `.claude/skills/speckit-*/` — essas
   pastas vêm do pacote `specify-cli` e são sobrescritas em
   `specify self upgrade`.
2. Crie `SKILL.md` com frontmatter:
   ```yaml
   ---
   name: nome-da-skill
   description: O que a skill faz e QUANDO se aplica — inclua a condição de preset se for stack-specific (ex.: "Use apenas quando project.config preset = X").
   ---
   ```
3. Se a skill tiver checklists longos ou referência extensa, mantenha o
   `SKILL.md` enxuto e mova o detalhe para `references/*.md` dentro da
   mesma pasta, citado a partir do `SKILL.md`.
4. Se a skill for condicional a um preset, registre-a em
   `.claude/skills/core/stack-detection/SKILL.md` na tabela de mapeamento
   preset → skills.

## Adicionando um novo comando

As 5 primeiras fases do SpecKit (Specification, Clarification, Plan,
Tasks, Implementation) já têm comando oficial (`/speckit-specify` etc.,
via `.claude/skills/speckit-*/`) — não crie um comando próprio para
substituí-las. Esta seção é para comandos como os que este workspace já
adiciona (`/test`, `/security`, `/security-audit`, `/review`, `/seo`), que
rodam depois de `/speckit-implement` ou fora do fluxo por feature.

1. Crie `.claude/commands/<nome>.md` com frontmatter mínimo:
   ```yaml
   ---
   description: O que o comando faz.
   ---
   ```
2. No corpo, inclua sempre o passo "leia `project.config.json`" antes de
   qualquer lógica condicional de stack.
3. Se o comando precisa de um artefato próprio em
   `specs/<NNN>-<slug>/`, crie o template correspondente em
   `.specify/templates/` (ex.: `security-review-template.md`) — mas nunca
   edite os templates oficiais (`spec`, `plan`, `tasks`, `constitution`,
   `checklist`), que pertencem ao motor do spec-kit.

## Adicionando uma nova stack

Exemplo: adicionar suporte a Drizzle ORM como terceira alternativa de banco.

1. Crie `.claude/skills/drizzle/SKILL.md` com a condição de preset
   (`preset: "drizzle-postgres"` ou o que fizer sentido).
2. Adicione o novo preset em `.claude/skills/core/stack-detection/SKILL.md`
   (tabela de presets → skills elegíveis).
3. Crie `project.config.drizzle.example.json` na raiz, espelhando os outros
   exemplos.
4. Se fizer sentido ter scaffold de referência, crie `templates/drizzle/`
   com `README.md` e arquivos de exemplo (não uma app completa).
5. Documente o novo preset na tabela do `README.md` (seção "Escolhendo o
   preset").
6. Garanta que a skill nova nunca seja carregada quando o preset for
   `prisma-postgres` ou `supabase`, e que `prisma`/`supabase` continuem
   sendo ignoradas quando o preset for o novo.

## Editando templates do SpecKit

Dois grupos distintos em `.specify/templates/`:

- **Oficiais** (`spec-template.md`, `plan-template.md`, `tasks-template.md`,
  `constitution-template.md`, `checklist-template.md`) — vêm do pacote
  `specify-cli` e são sobrescritos por `specify self upgrade` ou por um
  novo `specify init --here --force`. **Não edite estes diretamente.**
  Toda customização de regra/fluxo que precise valer nessas fases vai em
  `.specify/memory/constitution.md`, que `/speckit-plan` (e os demais
  comandos oficiais) lê como contexto/gate.
- **Próprios deste workspace** (`security-review-template.md`,
  `code-review-template.md`) — sem equivalente oficial, editáveis
  livremente. Ao editar:
  - Mantenha os placeholders entre colchetes (`[assim]`) — os comandos
    (`/security`, `/review`) instruem o agente a substituí-los.
  - Não remova a seção de rastreabilidade (link para `plan.md`/
    `security-review.md`) — é o que mantém spec → plan → tasks → review
    conectados.

Para atualizar o motor oficial em si (novas versões do spec-kit), rode
`specify self upgrade` (ou `specify init --here --force` de novo) e
reconcilie manualmente qualquer diferença que o merge não resolveu sozinho
— o `constitution.md` costuma ser preservado automaticamente.

## Revisão de mudanças no workspace

Mudanças em `.claude/skills/security/` ou `SECURITY.md` devem ser
revisadas com atenção redobrada — são a base do checklist que protege todo
projeto futuro gerado a partir daqui.

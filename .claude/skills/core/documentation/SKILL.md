---
name: documentation
description: Use ao escrever ou atualizar documentação de projeto (README de projeto, comentários de arquitetura, ADRs) — padrão de documentação deste workspace. Preset-agnóstica.
---

# Documentação

Padrão de documentação para projetos gerados a partir deste workspace.

## Regras

- README do projeto (não confundir com o README do workspace-template)
  documenta o produto: o que é, como rodar localmente, variáveis de
  ambiente necessárias (referenciando `templates/<stack>/.env.example`),
  como rodar testes.
- Comentários no código só quando o "porquê" não é óbvio (constraint
  escondida, workaround de bug específico, invariante não-trivial). Nunca
  comentário que descreve o que já é óbvio pelo nome do identificador.
- Decisões de arquitetura não-triviais viram um registro curto em
  `specs/<NNN>-<slug>/plan.md` (gerado pelo `/speckit-plan`) — não é
  necessário um sistema de ADR separado para este workspace.
- Não gerar documentação especulativa ("Future Work", "Roadmap") a menos
  que pedido explicitamente.

## Onde cada coisa é documentada

| Tipo de informação | Onde vive |
|---|---|
| O que a feature faz e por quê | `specs/<NNN>-<slug>/spec.md` |
| Perguntas resolvidas antes do plano | seção `## Clarifications` do próprio `spec.md` |
| Como foi implementada (arquitetura) | `specs/<NNN>-<slug>/plan.md` |
| Passo a passo de execução | `specs/<NNN>-<slug>/tasks.md` |
| Achados de segurança | `specs/<NNN>-<slug>/security-review.md` |
| Achados de code review | `specs/<NNN>-<slug>/code-review.md` |
| Como rodar o projeto | README do projeto |
| Princípios fixos do projeto | `.specify/memory/constitution.md` |

## Ao escrever para este workspace (não para um projeto)

Skills, comandos e templates aqui devem ser escritos para serem lidos por um
agente de IA primeiro e por um humano depois: diretos, com condições
explícitas ("use quando X", "não use quando Y"), sem prosa decorativa.

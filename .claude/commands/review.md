---
description: Revisão final de código da feature (fase Code Review do SpecKit, última etapa).
---

# /review [NNN ou slug da feature]

1. Leia `project.config.json` se ainda não leu nesta sessão.
2. Abra `specs/<NNN>-<slug>/spec.md`, `plan.md` e `security-review.md`.
   Se `security-review.md` não existir e a feature atendia aos critérios de
   obrigatoriedade em `SECURITY.md`, pare e rode `/security` primeiro.
3. Carregue a skill `code-review` e revise o código implementado (diff da
   feature) contra: correção (atende a spec?), simplicidade/reuso (YAGNI,
   sem duplicar o que uma skill já resolve), consistência com o preset
   ativo, confirmação dos achados de segurança, performance básica.
4. Crie `specs/<NNN>-<slug>/code-review.md` a partir de
   `.specify/templates/code-review-template.md`, listando achados
   específicos (arquivo:linha, problema, correção sugerida).
5. Se `--fix` for pedido explicitamente pelo usuário, aplique as correções
   dos achados após reportá-los — nunca corrija silenciosamente sem listar
   o achado primeiro.
6. Conclua com status Aprovado ou Mudanças solicitadas. "Aprovado" só é
   válido se todo item pendente de `security-review.md` foi resolvido ou
   aceito como risco.

Esta é a última fase do fluxo SpecKit para a feature.

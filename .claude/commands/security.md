---
description: Audita a feature contra o checklist de segurança do workspace (fase Security Review do SpecKit) e produz um Security Gate PASS/WARN/FAIL.
---

# /security [NNN ou slug da feature]

1. Leia `project.config.json` (skill `core/stack-detection`) para saber o
   preset.
2. Abra `specs/<NNN>-<slug>/spec.md` e `plan.md` para saber que dado, rota
   e tabela a feature envolve.
3. Confirme se esta fase é obrigatória para a feature, usando os critérios
   de [SECURITY.md](../../SECURITY.md) (auth, dado de usuário, upload,
   integração externa, tabela nova). Se nenhum critério bater, registre
   isso e pergunte ao usuário se ainda assim quer rodar a auditoria
   completa.
4. Siga o processo em
   `.claude/skills/security/references/pre-deploy-gate.md`:
   - identifique o escopo real da alteração e o **blast radius** (outros
     consumidores de um service/função alterado);
   - aplique o teste "não confie no frontend";
   - carregue só as referências de checklist relevantes (não as 6 de uma
     vez se só 2 se aplicam);
   - para cada achado, classifique evidência (CONFIRMADO/PROVÁVEL/
     POSSÍVEL/NÃO REPRODUZIDO/FALSE POSITIVE) e severidade (CRITICAL/HIGH/
     MEDIUM/LOW/INFORMATIONAL) — não invente vulnerabilidade "porque
     poderia ser".
5. Crie `specs/<NNN>-<slug>/security-review.md` a partir de
   `.specify/templates/security-review-template.md`, preenchendo achados,
   checklist por tópico e o bloco final **Security Gate**.
6. Se preset for `supabase` e a feature tocar tabela, a seção de RLS
   (`references/supabase-rls.md`) é obrigatória, não opcional.
7. Todo item "Pendente" deve ser corrigido no código antes de fechar esta
   fase, ou movido para "Riscos aceitos explicitamente" com aprovação
   clara do usuário — nunca deixado pendente em silêncio.
8. `/review` só pode declarar Aprovado se o Security Gate desta fase for
   PASS ou PASS WITH WARNINGS. Gate FAIL bloqueia — informe exatamente o
   que falta corrigir.

Esta fase examina o código de verdade (leia os arquivos implementados) —
não é um checklist preenchido só a partir da spec/plano. Para uma
auditoria de toda a plataforma (não desta feature), use `/security-audit`.

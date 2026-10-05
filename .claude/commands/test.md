---
description: Escreve e roda os testes de uma feature (fase Tests do SpecKit).
---

# /test [NNN ou slug da feature]

1. Leia `project.config.json` se ainda não leu nesta sessão.
2. Abra `specs/<NNN>-<slug>/plan.md` (seção "Estratégia de testes") e
   `tasks.md` (seção "Testes").
3. Carregue a skill `testing` e escreva os testes que faltam: unitário
   para lógica pura, integração contra banco real (nunca mockado — ver
   skill `testing`), E2E só para o(s) fluxo(s) crítico(s) definidos no
   plano.
4. Garanta cobertura mínima por feature: caminho feliz, autorização
   negativa (usuário sem permissão), validação Zod rejeitando input
   inválido, e a borda de dado específica do domínio.
5. Rode a suíte de testes e reporte o resultado real (não afirme "passa"
   sem ter rodado — ver skill `superpowers:verification-before-completion`).
6. Marque as tasks de teste correspondentes como concluídas em `tasks.md`.
7. Ao final, informe se a feature está pronta para `/security`.

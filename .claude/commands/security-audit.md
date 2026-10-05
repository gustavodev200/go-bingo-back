---
description: Auditoria completa de segurança de toda a aplicação (fora do fluxo por feature do SpecKit) — usa OWASP WSTG/ASVS/API Top 10.
---

# /security-audit

Diferente de `/security` (que audita uma feature específica dentro do
fluxo SpecKit), este comando audita **toda a plataforma** — use antes de
um marco importante (lançamento, cliente enterprise) ou em revisão
periódica, não a cada feature.

1. Leia `project.config.json` (skill `core/stack-detection`) para saber o
   preset e quais skills de stack se aplicam.
2. Avise o usuário: esta é uma auditoria não-destrutiva (não altera nem
   apaga dado real, não causa DoS) e que **nenhuma correção de código será
   feita nesta etapa** — só o relatório. Correções só depois de
   apresentado o relatório e com autorização explícita.
3. Siga `.claude/skills/security/references/full-audit.md` na íntegra:
   - Fase 1: mapeie a superfície de ataque completa (endpoints, services,
     tabelas, integrações, jobs, webhooks, Docker/infra).
   - Fase 2: monte a matriz de validação de entrada dos campos mais
     relevantes.
   - Fase 3: aplique os checklists por tópico já existentes na skill
     `security` (`auth-authz.md`, `injection.md`, `api-security.md`,
     `data-secrets-logging.md`, `file-uploads.md`, `supabase-rls.md` se
     aplicável).
   - Fase 4: cubra os tópicos exclusivos da auditoria completa (business
     logic, infraestrutura/Docker, cache/CDN, exports/relatórios, cron/
     filas, fuzzing controlado).
   - Fase 5: preencha as tabelas de status OWASP API Security Top 10 e
     OWASP ASVS (V1-V14).
4. Se o Semgrep (ou SAST equivalente) estiver disponível no projeto, rode
   como primeira passada (`semgrep --config auto .`) e trate o resultado
   como ponto de partida, não substituto da análise manual.
5. Classifique cada achado por evidência e severidade (mesmas regras do
   `pre-deploy-gate.md`) — nunca afirme "está seguro" sem ter testado;
   diga "não foi possível validar" quando for o caso.
6. Salve o relatório em
   `security-audits/<YYYY-MM-DD>-full-audit.md` na raiz do projeto,
   seguindo a estrutura de seções definida em `full-audit.md` (Executive
   Summary, Scope, Attack Surface, Security Score, findings por
   severidade, tabelas OWASP, Input Validation Matrix, auditorias
   específicas, Recommendations por prazo).
7. Finalize com o bloco `SECURITY STATUS` (CRITICAL/HIGH/MEDIUM/LOW/NO
   CRITICAL-HIGH ISSUES FOUND), um Top 10 de problemas priorizados, e a
   recomendação objetiva: é seguro prosseguir para produção?
8. Pare aqui. Só implemente correções se o usuário pedir explicitamente
   depois de ler o relatório.

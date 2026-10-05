# Checklist de Hardening para SaaS

Checklist de nível produto/organização — vai além de código. Complementa
`pre-deploy-gate.md` (por feature) e `full-audit.md` (auditoria técnica
completa) com itens de processo, infraestrutura e compliance que só fazem
sentido olhar para o produto como um todo. Use ao preparar um SaaS para
lançamento, para receber o primeiro cliente enterprise, ou em revisão
periódica.

Para cada item: confirme se está implementado; se não estiver, implemente
seguindo a melhor prática e explique a mudança — não marque como feito sem
verificar de verdade.

## Autenticação e sessão

- [ ] MFA obrigatório para contas admin (não precisa ser obrigatório para
      usuário comum, mas deve estar disponível).
- [ ] Política de senha forte + hash bcrypt/argon2 (ver `auth-authz.md`).
- [ ] Sessão/token com expiração curta + refresh seguro; logout remoto de
      sessões (revogar sessão de outro dispositivo).
- [ ] Bloqueio/atraso após tentativas de login falhas + rate limit no
      login (ver `auth-authz.md`, `api-security.md`).
- [ ] Verificação de email obrigatória no cadastro.
- [ ] Link de reset de senha com expiração curta e uso único.

## Autorização

- [ ] RBAC real — cada usuário acessa exatamente o necessário, nunca
      "todo mundo admin por conveniência".
- [ ] Rotas administrativas exigem login + permissão no servidor —
      esconder do menu não é proteção.

## Rede e transporte

- [ ] CSRF: `SameSite` configurado + token CSRF em mutações (ver
      `injection.md`).
- [ ] Rate limit em login, cadastro, reset de senha e busca.
- [ ] CORS sem `*` em produção — allowlist de domínios reais.
- [ ] Validação/sanitização de entrada em toda API (ver `injection.md`,
      skill `frontend/zod`).
- [ ] Secrets fora do bundle do frontend — nada de service role key,
      connection string ou secret de pagamento no client (ver
      `data-secrets-logging.md`).
- [ ] Dependências atualizadas (`npm audit`/Dependabot/Renovate).
- [ ] Headers de segurança (CSP, HSTS, X-Content-Type-Options,
      Referrer-Policy).
- [ ] Cookies com `HttpOnly`, `Secure`, `SameSite` corretos.
- [ ] Upload validado por tipo real, tamanho, renomeado, servido de
      domínio sem execução de script (ver `file-uploads.md`).
- [ ] Proteção contra SSRF em toda chamada de servidor a URL de usuário
      (ver `injection.md`).
- [ ] Webhooks recebidos validam assinatura antes de processar (ver
      `api-security.md`).

## Arquitetura (específico para preset Supabase)

- [ ] Frontend nunca fala direto com o banco sem passar por uma camada
      própria quando a operação exige lógica de autorização/rate limit
      adicional além do que RLS cobre — para acesso simples já protegido
      por RLS, o client direto é aceitável; para fluxo sensível, prefira
      Server Action/Route Handler como ponto central.
- [ ] RLS ativada em toda tabela — revise cada policy: ela realmente
      restringe pelo dono do dado, ou ficou `USING (true)` por
      conveniência? (ver `supabase-rls.md`).
- [ ] `service role key` nunca exposta ao client — só em código
      server-side, nunca em nada que roda no navegador ou app.

## Operação e observabilidade

- [ ] Logs de acesso e auditoria centralizados (quem acessou o quê, quando,
      de onde).
- [ ] Alertas automáticos para atividade suspeita (picos de tentativa de
      login, múltiplos IPs numa conta, export em massa de dados).
- [ ] Backups testados regularmente — restore validado, não só o backup
      em si.
- [ ] Mascaramento de dado sensível em log — nunca logar senha, token,
      número de cartão ou PII completa (ver `data-secrets-logging.md`).
- [ ] Rotação periódica de chaves/segredos — não só quando algo vaza.
- [ ] Revogação imediata de acesso de ex-funcionário/colaborador no mesmo
      dia da saída (repositórios, painéis, infraestrutura).

## Processo e compliance

- [ ] Plano de resposta a incidentes por escrito (quem faz o quê em caso
      de vazamento).
- [ ] Adequação básica à LGPD: saber quais dados pessoais são coletados,
      onde ficam armazenados, como o usuário pode pedir exclusão.
- [ ] Política de privacidade e termos de uso atualizados e coerentes com
      o que o sistema realmente faz com os dados.
- [ ] Canal de divulgação responsável de vulnerabilidade (ex.:
      `security@seudominio.com`) — ver [SECURITY.md](../../../../SECURITY.md).
- [ ] Pentest ou revisão de segurança externa antes de escalar o produto —
      complementa `full-audit.md`, que é auto-conduzida.

## Resumo final de 20 hardenings essenciais (referência rápida)

1. Ocultar chaves de API.
2. Remover segredo do histórico do Git (se algum foi commitado).
3. Usar credencial de banco com privilégio mínimo, não superuser.
4. Ativar RLS (Supabase) ou checagem de ownership explícita (Prisma).
5. Criptografar dado sensível em repouso quando aplicável.
6. Impor autenticação no servidor, nunca só no client.
7. Restringir acesso a registro pelo dono/role (autorização).
8. Impedir adulteração de campo (mass assignment — ver `api-security.md`).
9. Proteger cookie de sessão (`HttpOnly`, `Secure`, `SameSite`).
10. Armazenar senha com hash (bcrypt/argon2).
11. Limitar tentativas de login.
12. Adicionar proteção contra bot em formulário público (captcha/honeypot)
    quando o abuso for um risco real.
13. Usar consulta parametrizada, nunca concatenada.
14. Validar toda entrada de dado (Zod na borda).
15. Escapar conteúdo enviado por usuário antes de renderizar.
16. Restringir upload de arquivo (tipo, tamanho, storage).
17. Retornar só o dado necessário nas respostas de API.
18. Adicionar headers de segurança.
19. Forçar HTTPS.
20. Fazer varredura de dependência vulnerável regularmente.

Ao final de uma revisão usando este checklist, resuma os riscos críticos
ainda em aberto, em ordem de prioridade — não apenas a lista de itens
marcados.

# Secrets, Exposição de Dados, Logs, Dependências

## Secrets

- [ ] Nenhum secret (API key, connection string, client secret) em código
      fonte versionado — sempre variável de ambiente (`.env`, nunca
      commitado; `.env.example` só com placeholder).
- [ ] Secrets de produção vivem no gerenciador do provedor de deploy
      (Vercel/Hostinger/etc.), não em arquivo `.env` copiado manualmente
      para o servidor sem controle de acesso.
- [ ] Nenhuma env var sensível exposta ao client (Next.js: nunca prefixo
      `NEXT_PUBLIC_` num secret).
- [ ] Rotação de secret vazado é possível sem redeploy longo (secret não
      hardcoded em múltiplos lugares).

## Exposição de dados

- [ ] Endpoints e queries retornam só os campos necessários (`select`
      explícito), não o objeto inteiro do banco — evita vazar campo
      sensível (hash de senha, token interno) por acidente numa resposta.
- [ ] Mensagens de erro de "usuário não encontrado" vs "senha errada" são
      idênticas no login, para não permitir enumeração de contas.
- [ ] Dados de um usuário nunca aparecem na resposta destinada a outro
      (ver `auth-authz.md`, IDOR).

## Logs

- [ ] Nunca logar senha, token de sessão/reset, número de cartão ou
      segredo de API, mesmo em log de debug.
- [ ] PII (email, telefone, documento) logada só quando necessário para
      operação/suporte, com retenção definida — não logar por padrão "só
      para garantir".
- [ ] Logs de erro em produção vão para um serviço centralizado, não só
      `console.log` (facilita auditoria e detecção de incidente).

## Dependências vulneráveis

- [ ] `npm audit` (ou equivalente) rodando no CI, falhando o build em
      vulnerabilidade alta/crítica sem patch pendente aceito
      conscientemente.
- [ ] Dependabot/Renovate configurado para abrir PR de atualização de
      dependência automaticamente.
- [ ] Dependência nova avaliada antes de adicionar: mantida ativamente,
      sem alternativa nativa/já presente que resolva o mesmo problema.

## Configuração de produção

- [ ] `NODE_ENV=production` (ou equivalente) em produção — nenhum modo
      debug/verbose ligado por padrão.
- [ ] Documentação de API (Swagger/OpenAPI) não fica publicamente acessível
      em produção sem autenticação, a menos que seja intencionalmente uma
      API pública documentada.
- [ ] Nenhuma rota de teste, seed ou debug (`/debug`, `/test`, `/__internal`)
      acessível em produção.
- [ ] Health check não vaza detalhe interno (versão de dependência, stack
      trace, string de conexão) — retorna só status.
- [ ] Porta de banco de dados/admin não exposta publicamente na
      infraestrutura (firewall/security group restringe a IPs/serviços
      que precisam acessar).
- [ ] Se houver Docker: container roda como usuário não-root, sem
      `--privileged`, sem montar o socket do Docker do host, sem
      `network: host` desnecessário.

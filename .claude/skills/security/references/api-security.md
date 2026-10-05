# Rate Limiting, CORS, Headers, Segurança de API

## Rate limiting

- [ ] Rotas sensíveis (login, signup, reset de senha, envio de email,
      qualquer endpoint público sem auth) têm rate limit por IP e/ou por
      conta.
- [ ] Rate limit retorna `429` com mensagem genérica — não revela se o
      limite é por IP, por usuário ou o valor exato do limite.
- [ ] NestJS: usar guard de throttling (`@nestjs/throttler` ou
      equivalente). Next.js/Supabase: middleware ou serviço externo
      (Upstash Ratelimit, etc.), conforme disponibilidade do projeto.

## CORS

- [ ] Allowlist explícita de origens permitidas — nunca `*` quando a rota
      aceita credenciais (cookie/Authorization).
- [ ] Métodos e headers permitidos restritos ao necessário, não
      `Access-Control-Allow-Methods: *`.

## Headers de segurança

- [ ] `Content-Security-Policy` configurada (ao menos restringindo
      `script-src` a self + domínios confiáveis).
- [ ] `Strict-Transport-Security` em produção (HTTPS obrigatório).
- [ ] `X-Content-Type-Options: nosniff`.
- [ ] `Referrer-Policy` razoável (ex.: `strict-origin-when-cross-origin`).
- [ ] Next.js: configurar via `next.config.js` (`headers()`) para aplicar
      globalmente, em vez de por rota.

## Segurança de API (geral)

- [ ] Toda rota, exceto as explicitamente públicas, exige autenticação —
      "esqueci de proteger" é o erro mais comum; audite a lista completa
      de rotas na Security Review.
- [ ] Versionamento de API público (`/api/v1/...`) se a API for consumida
      por terceiros, para permitir mudança sem quebrar clientes existentes.
- [ ] Respostas de erro não vazam stack trace, query SQL ou detalhe interno
      — mensagem genérica pro client, log detalhado só server-side (ver
      `data-secrets-logging.md`).
- [ ] Paginação obrigatória em endpoints de listagem que podem crescer sem
      limite — evita tanto DoS acidental quanto vazamento de volume total
      de dados via contagem.

## Mass Assignment / Broken Object Property Level Authorization

- [ ] DTO/schema Zod de entrada lista explicitamente os campos aceitos
      (`role`, `isAdmin`, `ownerId`, `status`, `price`, `verified`, etc.
      nunca vêm do body de um usuário comum) — nunca faça `{...body}`
      direto num `create`/`update` do Prisma ou num `insert`/`update` do
      Supabase.
- [ ] Campos administrativos/internos só são graváveis por uma rota
      separada, protegida por autorização de admin, nunca pelo mesmo
      endpoint que o usuário comum usa para editar o próprio recurso.
- [ ] Resposta da API também é filtrada pelo mesmo princípio (ver
      `data-secrets-logging.md`, Exposição de dados) — o schema de saída
      não é simplesmente o schema do banco.

## HTTP Parameter Pollution

- [ ] Parâmetros duplicados na query string (`?role=user&role=admin`) ou
      no body têm comportamento definido e testado — o framework/handler
      usa consistentemente o primeiro, o último, ou rejeita duplicata; não
      depender do comportamento implícito de uma lib para uma decisão de
      autorização ou preço.
- [ ] Nenhuma decisão sensível (papel, preço, quantidade) é lida de um
      parâmetro que pode ser enviado mais de uma vez sem normalização
      explícita antes da leitura.

## Webhooks recebidos

- [ ] Todo webhook recebido de terceiro (pagamento, email, storage) valida
      a assinatura do payload (HMAC ou equivalente do provedor) antes de
      processar — nunca confiar só na URL ser "secreta".
- [ ] Timestamp do payload validado contra uma janela curta para mitigar
      replay de uma requisição capturada.
- [ ] Processamento do webhook é idempotente (reenvio do mesmo evento não
      duplica efeito — ex.: não credita saldo duas vezes).

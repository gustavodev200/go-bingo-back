# Autenticação, Autorização, RBAC, IDOR

## Autenticação

- [ ] Senha nunca armazenada em texto plano (Better Auth/Supabase Auth já
      cuidam disso — não reimplemente hashing manual).
- [ ] Rate limit em login, signup, reset de senha e verificação de código
      (ver `api-security.md`).
- [ ] Sessão expira (tempo de vida configurado, não "para sempre" por
      padrão).
- [ ] Logout invalida a sessão no servidor, não só remove o token no
      client.
- [ ] Reset de senha usa token de uso único com expiração curta, enviado
      só para o email cadastrado.

## Autorização

- [ ] Toda rota/Server Action protegida verifica sessão **e** permissão
      específica da ação — sessão válida não é o mesmo que autorizado a
      fazer X.
- [ ] Checagem de autorização acontece no servidor (service, Route
      Handler, Server Action) — nunca só escondendo botão/link no client.
- [ ] RBAC (se o projeto tiver papéis): a checagem de role usa a fonte de
      verdade do banco/sessão, nunca um valor vindo do client (ex.: não
      confiar em `role` enviado no body do request).

## IDOR (Insecure Direct Object Reference)

- [ ] Toda operação que recebe um ID (via URL, body ou query) confirma que
      o recurso pertence ao usuário autenticado (ou que o usuário tem
      permissão explícita sobre ele) antes de ler/alterar/deletar.
- [ ] IDs sequenciais previsíveis (`/orders/123`) não são, por si só, um
      problema — o problema é a ausência da checagem de ownership acima.
      UUID não é substituto de autorização.
- [ ] Endpoints de listagem filtram pelo usuário/tenant no `WHERE` da
      query (ou via RLS no Supabase) — nunca trazem tudo e filtram no
      client.

## Hashing de senha

- [ ] Senha sempre hasheada com `bcrypt` ou `argon2` (Better Auth/Supabase
      Auth já usam um destes) — nunca MD5, SHA-1/256 sozinho, nem hash sem
      salt.
- [ ] Custo/rounds do hash configurado num valor atual recomendado pela
      lib (não reduzido "para ficar mais rápido").
- [ ] Senha nunca aparece em log, resposta de API ou mensagem de erro, em
      nenhuma hipótese — nem hasheada.
- [ ] Bloqueio ou atraso progressivo após N tentativas de login erradas
      por conta (além do rate limit por IP — ver `api-security.md`),
      evitando brute force distribuído por múltiplos IPs contra uma única
      conta.

## JWT / Tokens de sessão

Aplicável quando o projeto usa JWT (ex.: token entre Next.js e NestJS, ou
token de API pública) além de/complementando a sessão do provider de auth.

- [ ] Algoritmo de assinatura fixado explicitamente no verificador (ex.:
      `HS256` ou `RS256`) — nunca aceitar `alg: none` nem deixar o token
      declarar seu próprio algoritmo sem checagem.
- [ ] `exp` (expiração) sempre validado; access token de vida curta
      (minutos/poucas horas), refresh token de vida mais longa mas com
      rotação a cada uso.
- [ ] `iss`/`aud` validados quando o token pode ser aceito por mais de um
      serviço, para impedir replay de token emitido para outro público.
- [ ] Refresh token revogável (lista de revogação ou versão de sessão no
      banco) — logout ou troca de senha invalida refresh tokens
      existentes, não só o access token corrente.
- [ ] Segredo/chave de assinatura do JWT nunca hardcoded, nunca reutilizado
      entre ambientes (dev/staging/produção têm segredos distintos).

## No preset Supabase

RLS é a camada de autorização de dado (ver `supabase-rls.md`) — mas rotas
de Server Action/Edge Function que usam a `service role key` bypassam RLS e
precisam repetir a checagem de ownership manualmente, como no preset
Prisma.

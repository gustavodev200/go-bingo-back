# SQL Injection, XSS, CSRF, SSRF

## SQL Injection

- [ ] Nenhuma query concatena valor de usuário direto em string SQL.
- [ ] Prisma: usar API normal (`findMany`, `where`, etc.) ou `$queryRaw`
      com template tag parametrizado — nunca `$queryRawUnsafe` com input de
      usuário.
- [ ] Supabase: SQL raw (via RPC/função Postgres) usa parâmetros
      (`$1`, `$2` ou argumentos nomeados da function) — nunca string
      interpolada.

## XSS (Cross-Site Scripting)

- [ ] Conteúdo de usuário renderizado como texto por padrão (JSX já escapa
      automaticamente) — `dangerouslySetInnerHTML` só com conteúdo
      sanitizado por uma lib confiável (ex.: DOMPurify), nunca com HTML de
      usuário cru.
- [ ] Conteúdo de usuário em email (Resend) também escapado/sanitizado
      antes de ir para o template — mesmo risco em clients de email que
      renderizam HTML.
- [ ] Atributos dinâmicos (`href`, `src`) vindos de usuário validados
      (não aceitar `javascript:` como esquema de URL).

## CSRF (Cross-Site Request Forgery)

- [ ] Mutações (POST/PUT/PATCH/DELETE) exigem sessão com cookie
      `sameSite=lax` ou `strict` (padrão do Better Auth/Supabase Auth) —
      não enfraquecer para `none` sem motivo forte.
- [ ] Server Actions do Next.js já têm proteção CSRF nativa (token de
      origem) — não desabilitar verificações de origem/host.
- [ ] Route Handlers que aceitam mutação de client externo (não same-site)
      usam autenticação por token (API key/Bearer), não só cookie.

## SSRF (Server-Side Request Forgery)

- [ ] Toda URL fornecida por usuário que o servidor vai buscar (fetch,
      webhook de saída, preview de link) é validada: protocolo permitido
      (`https`/`http` apenas), host não aponta para IP privado/loopback
      (`127.0.0.1`, `169.254.169.254` — metadata de cloud, ranges
      `10.x`/`192.168.x`/`172.16-31.x`).
- [ ] Redirecionamentos da URL de destino são seguidos com o mesmo
      validador (não validar só a URL inicial e ignorar redirect).
- [ ] Timeout curto e sem seguir infinitos redirects em fetch server-side
      de URL de usuário.

## Path Traversal

- [ ] Nenhum caminho de arquivo é montado por concatenação direta de valor
      de usuário (`../`, `..\`, variantes com encoding como `%2e%2e%2f`).
- [ ] Nome de arquivo/caminho fornecido por usuário (download, export,
      leitura de template, acesso a asset) é validado contra uma allowlist
      ou resolvido e comparado contra o diretório base permitido
      (`path.resolve` + checagem de prefixo), nunca usado cru.
- [ ] Operações de import/export/leitura de arquivo nunca aceitam caminho
      absoluto fornecido pelo cliente.

## Command Injection

- [ ] Nenhum valor de usuário chega a `exec`, `spawn`, `child_process`,
      chamada de shell ou equivalente. Se for inevitável rodar um comando
      externo, use a forma que não passa por shell (array de argumentos,
      não string interpolada) e restrinja o binário chamado a uma
      allowlist fixa.
- [ ] Nenhuma feature de "conversão", "processamento de mídia" ou
      "geração de relatório" invoca ferramenta de linha de comando (ex.:
      ImageMagick, pandoc, ffmpeg) passando nome/conteúdo de arquivo do
      usuário sem sanitização.

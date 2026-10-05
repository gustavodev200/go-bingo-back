# Upload de Arquivos

## Validação

- [ ] Tipo de arquivo validado pelo conteúdo real (magic bytes), não só
      pela extensão ou `Content-Type` declarado pelo client (ambos são
      forjáveis).
- [ ] Tamanho máximo de arquivo aplicado no servidor (não só no client) —
      evita DoS por upload de arquivo enorme.
- [ ] Nome de arquivo do usuário nunca usado diretamente como path no
      storage — gere um nome/ID novo (evita path traversal e colisão).

## Armazenamento

- [ ] Arquivo enviado por usuário fica fora do webroot público (não em
      `public/uploads` servido estaticamente sem controle de acesso) — use
      bucket de storage (Supabase Storage, S3-compatible) com policy de
      acesso.
- [ ] Bucket privado por padrão; URL de acesso via signed URL com
      expiração, a menos que o arquivo seja intencionalmente público (ex.:
      avatar).
- [ ] No preset Supabase, policy de Storage segue o mesmo princípio de RLS
      (ver `supabase-rls.md`): sem policy explícita, sem acesso.

## Servindo o arquivo de volta

- [ ] Ao servir arquivo enviado por usuário (ex.: imagem, PDF), header
      `Content-Disposition` e `Content-Type` corretos para evitar que o
      browser execute o arquivo como script (especialmente para SVG, que
      pode conter JS — trate como HTML/XSS se for exibido inline).
- [ ] Scan de malware/antivírus quando o arquivo é acessível por outros
      usuários além de quem fez upload (ex.: anexo compartilhado em time).

## YAGNI

Não construa pipeline de processamento de imagem (resize, otimização)
"para o futuro" — adicione quando a feature realmente precisar.

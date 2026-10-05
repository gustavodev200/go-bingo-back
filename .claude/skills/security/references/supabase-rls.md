# RLS no Supabase

RLS (Row Level Security) é **obrigatória** em toda tabela do schema
`public` (ou qualquer schema exposto via API) em projetos com preset
`supabase`. Este é o controle de autorização de dado mais importante do
preset — sem ele, qualquer tabela exposta ao PostgREST/`supabase-js` fica
acessível por qualquer requisição autenticada com a `anon key` (que é
pública, embutida no bundle do client).

## Regra central

- [ ] Toda tabela nova criada por migration tem, na mesma migration:
      `ALTER TABLE <tabela> ENABLE ROW LEVEL SECURITY;` seguido das
      policies necessárias. RLS nunca é adicionada "depois, numa migration
      separada, quando lembrar".
- [ ] Uma tabela com RLS habilitada e **nenhuma policy** fica totalmente
      bloqueada (correto por padrão) — isso não é bug, é o estado seguro.
      Se a feature "não funciona", o problema é policy faltando, não RLS
      sobrando.
- [ ] Nenhuma policy usa `USING (true)` / `WITH CHECK (true)` sem
      justificativa explícita documentada no `plan.md` (equivale a "tabela
      pública para qualquer um logado" — só aceitável se for
      intencionalmente esse o caso, ex.: tabela de categorias públicas).

## Policies por operação

- [ ] `SELECT`, `INSERT`, `UPDATE`, `DELETE` têm policies pensadas
      separadamente — uma policy de `SELECT` correta não implica policy de
      `UPDATE` correta.
- [ ] Policy de ownership típica compara `auth.uid()` com a coluna de dono
      da linha (ex.: `user_id = auth.uid()`), nunca um valor vindo do
      payload do client.
- [ ] RBAC via RLS: se o projeto tem papéis, a policy consulta uma tabela/
      claim de role (ex.: JWT custom claim ou tabela `user_roles`), não um
      campo que o próprio usuário pode editar.

## Auditoria de tabelas expostas

- [ ] Ao final de cada feature que mexe em schema, liste todas as tabelas
      tocadas e confirme, uma a uma: RLS habilitada? Policies cobrem
      SELECT/INSERT/UPDATE/DELETE conforme o caso de uso real? Nenhuma
      policy mais permissiva do que o necessário?
- [ ] Views e functions (`SECURITY DEFINER`) expostas via API também
      herdam essa auditoria — uma function `SECURITY DEFINER` mal escrita
      pode contornar RLS da tabela subjacente.

## Service role

- [ ] Uso da `service role key` (que bypassa RLS) é exceção documentada no
      `plan.md`, restrita a Server Actions/Route Handlers/Edge Functions —
      nunca chega ao client, e o código que a usa reimplementa a checagem
      de autorização manualmente (já que RLS não está protegendo ali).

Esta checklist é obrigatória na fase **Security Review** (`/security`) de
qualquer feature com preset `supabase` que crie ou altere tabela.

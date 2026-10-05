# Wiring — Preset B: Next.js + Supabase

Guia de como as peças se conectam. Não é um passo a passo de instalação
(isso está em `templates/nextjs/README.md` e `templates/supabase/README.md`)
— é o mapa de como o frontend fala com o Supabase.

## Topologia

```
Next.js (Server Component / Server Action)
      |
      | client anon (@supabase/ssr) --> protegido por RLS
      |
      v
   Supabase (PostgreSQL + Auth + Storage)
      ^
      | client service role (só em Server Action/Edge Function excepcional)
      |
Next.js (rota administrativa restrita)
```

## Regra de ouro

O client **anon** é o caminho normal para 95% das operações — RLS decide o
que cada usuário pode ver/alterar. O client com **service role** é exceção,
documentada, e nunca chega ao browser.

## Fluxo de uma mutação típica

1. Formulário shadcn/ui no Next.js valida com Zod (`zodResolver`).
2. Server Action valida o mesmo schema Zod na borda (defesa em
   profundidade — RLS não substitui isso).
3. Server Action usa o client Supabase server-side (`@supabase/ssr`), com a
   sessão do usuário — a chamada já passa pela RLS automaticamente.
4. Se a policy de RLS rejeitar, o Supabase retorna erro — trate e mostre
   mensagem apropriada ao usuário (nunca vaze detalhe da policy).
5. Resposta tipada volta ao Next.js.

## Onde cada skill entra

`frontend/nextjs`, `frontend/zod`, `frontend/shadcn-ui` no Next.js;
`supabase`, `database/postgresql` no acesso a dado; `security` (auth-authz,
injection, api-security e **obrigatoriamente** `supabase-rls`) em toda
feature que toca tabela.

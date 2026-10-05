---
name: resend
description: Use ao enviar email transacional (verificação de conta, reset de senha, notificação) via Resend. Preset-agnóstica — usada tanto no preset Prisma/PostgreSQL quanto no Supabase.
---

# Resend

## Onde a chamada acontece

- Envio de email sempre server-side (Server Action, Route Handler, service
  do NestJS, ou Edge Function do Supabase) — a API key da Resend nunca é
  exposta ao client.
- Um único módulo/service centraliza o client da Resend
  (`lib/email/resend.ts` ou `EmailService` no NestJS) — não instancie o
  client em múltiplos pontos.

## Templates

- Use React Email (`@react-email/components`) para templates, renderizado
  antes de passar pro `resend.emails.send`, em vez de strings HTML soltas.
- Template por tipo de email (`VerifyEmail`, `PasswordReset`,
  `InviteMember`) em arquivos separados.

## Confiabilidade

- Trate falha de envio (retorno de erro da API) sem quebrar o fluxo
  principal do usuário quando o email for secundário (ex.: notificação) —
  logue o erro, mas não impeça a ação principal, a menos que o email seja
  parte crítica do fluxo (ex.: verificação obrigatória).
- Nunca coloque conteúdo não sanitizado de usuário direto no HTML do email
  sem escapar — mesmo risco de XSS que em página web, se o email for aberto
  em client que renderiza HTML.

## Segredos

- `RESEND_API_KEY` só em variável de ambiente server-side, nunca com
  prefixo `NEXT_PUBLIC_`.

## YAGNI

Não construa um sistema de fila de emails próprio a menos que o volume ou a
spec da feature exija — chamada direta à API da Resend é suficiente para a
maioria dos casos.

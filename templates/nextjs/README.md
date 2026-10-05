# Template: Next.js

Scaffold de referência, não uma aplicação pronta para rodar. Use como
checklist de setup ao iniciar o frontend de um projeto novo (Preset A ou
Preset B — este template é comum aos dois).

## Setup

```bash
npx create-next-app@latest --typescript --tailwind --app --src-dir
npx shadcn@latest init
```

## Dependências comuns aos dois presets

```bash
npm install zod zustand resend
npx shadcn@latest add button form input dialog # + componentes conforme a feature
```

## Estrutura sugerida

```
src/
  app/                # rotas (App Router)
  components/
    ui/               # componentes shadcn (gerados, editáveis)
  lib/
    stores/           # stores Zustand (ver skill frontend/zustand)
    email/            # client Resend (ver skill frontend/resend)
    validations/      # schemas Zod usados em mais de um lugar
```

## Arquivos deste template

- `tsconfig.json` — baseline com `strict: true` e paths alias.
- `.env.example` — variáveis de ambiente comuns (sem segredo real).

## Skills relacionadas

`frontend/nextjs`, `frontend/shadcn-ui`, `frontend/tailwind`,
`frontend/zod`, `frontend/zustand`, `frontend/resend`, e `frontend/better-
auth` (Preset A) — ver `.claude/skills/`.

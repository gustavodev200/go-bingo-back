---
name: postgresql
description: Use ao desenhar schema, índices ou queries em PostgreSQL — regras válidas independente de estar por trás de Prisma ou de Supabase. Preset-agnóstica; para regras específicas de cada ORM/plataforma, ver skills prisma ou supabase.
---

# PostgreSQL

Regras de banco de dados válidas para os dois presets deste workspace,
independente de você acessar o Postgres via Prisma ou via Supabase.

## Schema

- Toda tabela tem chave primária explícita (`id` UUID ou serial — escolha
  um padrão por projeto e mantenha consistente).
- Toda foreign key tem índice (evita full scan em joins e em `ON DELETE`).
- `created_at`/`updated_at` em toda tabela que representa uma entidade de
  negócio (não em tabelas puramente de junção sem necessidade).
- Nomes de tabela e coluna em `snake_case`, minúsculo.

## Migrations

- Toda alteração de schema passa por migration versionada (Prisma Migrate
  ou migration SQL do Supabase) — nunca alteração manual direto no banco de
  produção.
- Migration que remove coluna/tabela: confirme que nada em produção ainda
  lê o dado antes de aplicar (não é reversível sem backup).

## Performance

- Índice em toda coluna usada em `WHERE`, `ORDER BY` ou `JOIN` com
  frequência, mas não crie índice especulativo em coluna nunca filtrada.
- Evite `SELECT *` em código de aplicação — selecione as colunas
  necessárias, especialmente em tabelas largas.
- Ver skill `performance` para otimização de query mais a fundo (N+1,
  paginação, etc.).

## Segurança de banco

- Connection string com usuário de menor privilégio necessário
  (aplicação não conecta como superuser).
- Nunca concatenar valor de usuário direto em SQL — sempre query
  parametrizada (Prisma faz isso por padrão; em SQL raw do Supabase, use
  sempre parâmetros, nunca template string). Ver skill `security`.
- Backups automáticos habilitados e testados (restore, não só o backup em
  si) antes de depender deles em produção.

## YAGNI

Não introduza particionamento de tabela, read replica ou connection pooler
externo a menos que o volume real do projeto justifique.

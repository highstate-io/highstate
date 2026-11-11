# Prisma

The backend package owns the Prisma schemas and migration tooling for the backend and project databases.

Read the relevant schema under `packages/platform/backend/prisma/` before changing a database entity.
Run migration commands from `packages/platform/backend`.

## Project Database

Reset the temporary migration database before generating a project database migration:

```bash
bun run migration:reset:project
bun run migration:create:project -- --name <migration-name>
```

## Backend Database

Reset the temporary migration database before generating a backend SQLite migration:

```bash
bun run migration:reset:backend
bun run migration:create:backend -- --name <migration-name>
```

PostgreSQL has an independent backend migration pack.
Use a disposable PostgreSQL database with permissions to create the shadow database, and set `DATABASE_URL`
for both commands:

```bash
export DATABASE_URL=postgresql://postgres:password@localhost:5432/highstate_migrations
bun run migration:reset:backend:postgresql
bun run migration:create:backend:postgresql -- --name <migration-name>
```

Shared backend schema changes need migrations for both SQLite and PostgreSQL.
The PostgreSQL bootstrap metadata table is owned by `src/database/postgresql.ts`, outside the Prisma schema,
because it tracks the version needed to apply the first migration.

## Registration

Always create migration directories through the backend package scripts.
Generated SQL may be edited when the migration requires behavior Prisma cannot express directly.

Review the generated SQL, then register the migration in the corresponding `migrationPacks` entry in
`packages/platform/backend/src/database/migration.ts`.

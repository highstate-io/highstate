# Prisma

The backend package owns the Prisma schemas and migration tooling for the backend and project databases.

Read the relevant schema under `packages/platform/backend/prisma/` before changing a database entity.
Run migration commands from `packages/platform/backend`.

Use Prisma's implicit many-to-many relations when the relationship has no fields of its own.
Create an explicit join model only when the relationship stores domain data or has its own identity.

Document every model field and enum value with a nonempty `///` description. Type annotations alone do
not replace a description. Separate each field or enum value, including its documentation block, from
the preceding entry with a blank line. `bun run lint` checks these rules; `bun run lint:fix` adds missing
spacing but never invents documentation.

## Optimistic Concurrency

Use an entity `revision` when clients replace an editable configuration from a previously read snapshot
and a stale write could silently discard another writer's changes. Do not add revisions to every model:
immutable records, append-only logs, derived status and targeted atomic commands do not need them merely
because they are persisted.

- Generate `revision` server-side as an opaque CUIDv2 token on creation and each protected mutation.
- Require the token read with the edited values for replacement and deletion. Compare it for equality in
  the same transaction or conditional write that performs the mutation; generate a fresh token even if
  values return to an earlier configuration.
- Omit the expected token for creation. A missing record with an expected token is a conflict, not a create.
- Keep the original token with the editor draft or confirmed deletion target. Never substitute a newer
  live-sync token before saving, and never silently retry a conflicting replacement.
- Include tokens in transport for clients, but never display them in forms or tables, order them, increment
  them, or use them as timestamps, content hashes, or adapter cache keys.
- Scope the token to the configuration being protected. Usage bookkeeping such as API-key last-use times
  must not invalidate an unrelated configuration draft; internal writers of protected configuration must
  participate in the same concurrency contract.

Content hashes for reproducibility and evaluation validity, and integer generations fencing worker
attempts or connections, serve different purposes and are not entity concurrency tokens.

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

The backend has no PostgreSQL migration pack, so do not generate PostgreSQL migrations.

## Registration

Always create migration directories through the backend package scripts.
Generated SQL may be edited when the migration requires behavior Prisma cannot express directly.

Review the generated SQL, then register the migration in the corresponding `migrationPacks` entry in
`packages/platform/backend/src/database/migration.ts`.

# PostgreSQL backend storage

Set these variables before creating backend services:

```bash
HIGHSTATE_BACKEND_DATABASE_TYPE=postgresql
HIGHSTATE_BACKEND_DATABASE_POSTGRESQL_URL=postgresql://highstate:password@postgres:5432/highstate
HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH=/run/secrets/highstate-age-identity
HIGHSTATE_ENCRYPTION_ENABLED=true
```

Provision the AGE identity file once and mount the same identity on every restart.
The file contains a single `AGE-SECRET-KEY-...` identity, with optional surrounding whitespace.
`HIGHSTATE_BACKEND_DATABASE_IDENTITY` can supply that identity directly and takes precedence over the file.
PostgreSQL startup requires one of these sources and never creates an ephemeral identity or uses the OS keyring.
An unreadable or incorrect identity fails startup without replacing stored keys.

The PostgreSQL URL configures the Prisma PostgreSQL adapter, including connection-string TLS options.
The database user needs schema creation and modification privileges for automatic startup migrations.
Use a dedicated database/schema for each backend.
Startup serializes migrations using a transaction-scoped advisory lock and commits schema changes, version tracking,
and initial encrypted federation key metadata together.
A database version newer than the running backend is rejected without modifying its version.

PostgreSQL stores global backend records and encrypted federation key metadata.
It does not provide application-level encryption of all backend rows.
Backend unlock-recipient rotation re-encrypts the federation key and always retains the startup identity's recipient.
Back up PostgreSQL and the provisioned startup identity independently.

Project databases remain encrypted local SQLite files, and artifact payloads remain encrypted with project keys.
`HIGHSTATE_ENCRYPTION_ENABLED` defaults to `true`; PostgreSQL startup rejects `false`.
Persist the codebase `.highstate` directory containing project databases and artifact files across hosted restarts.
PostgreSQL storage does not provide distributed project ownership or active-active coordination.

## Verification

The opt-in integration tests create and drop isolated PostgreSQL schemas in the supplied database:

```bash
HIGHSTATE_TEST_POSTGRESQL_URL=postgresql://postgres:password@localhost:5432/highstate_test \
  bun run test src/database/postgresql.test.ts
```

Migration generation uses `DATABASE_URL` and the backend package scripts described in
[`dev-docs/engineering/prisma.md`](../../../../../dev-docs/engineering/prisma.md).

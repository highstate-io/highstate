import type { Logger } from "pino"
import type { BackendDatabaseBackend } from "./abstractions"
import { hostname } from "node:os"
import { PrismaPg } from "@prisma/adapter-pg"
import { identityToRecipient } from "age-encryption"
import { z } from "zod"
import {
  createBackendPrivateKey,
  encryptSecret,
  getInitialBackendUnlockMethodMeta,
  readBackendPrivateKey,
} from "./local/backend"
import { backendIdentityConfig, getOrCreateBackendIdentity } from "./local/keyring"
import { migrateDatabase, migrationPacks } from "./migration"
import { BackendDatabase } from "./prisma"
import { ensureWellKnownEntitiesCreated } from "./well-known"

export const postgresqlBackendDatabaseConfig = z.object({
  HIGHSTATE_BACKEND_DATABASE_POSTGRESQL_URL: z.url().optional(),
  ...backendIdentityConfig.shape,
})

type PostgresqlConfig = z.infer<typeof postgresqlBackendDatabaseConfig> & {
  HIGHSTATE_ENCRYPTION_ENABLED: boolean
}

type BackendMetadata = {
  version: number
  privateKey: string
}

// the bootstrap table is deliberately outside the Prisma schema: it must exist before migration 1
// the transaction-scoped lock serializes both first startup and later schema upgrades
const startupLock = 724167809

class PostgresqlBackendDatabaseBackend implements BackendDatabaseBackend {
  readonly isEncryptionEnabled = true

  constructor(
    readonly database: BackendDatabase,
    readonly backendId: string,
    readonly privateKey: string,
    private readonly identity: string,
    private readonly schema: string,
  ) {}

  async reencryptSecrets(recipients: string[]): Promise<void> {
    const allowedRecipients = new Set(recipients)
    allowedRecipients.add(await identityToRecipient(this.identity))
    const encryptedPrivateKey = await encryptSecret(this.privateKey, allowedRecipients)

    await this.database.$executeRawUnsafe(
      `UPDATE "${this.schema.replaceAll('"', '""')}"."_highstate_backend" SET "privateKey" = $1 WHERE "id" = 1`,
      encryptedPrivateKey,
    )
  }
}

/**
 * Opens PostgreSQL backend storage using an explicitly provisioned, stable AGE identity.
 * Project databases and artifact payloads retain their independent encryption.
 */
export async function createPostgresqlBackendDatabaseBackend(
  config: PostgresqlConfig,
  logger: Logger,
): Promise<BackendDatabaseBackend> {
  if (!config.HIGHSTATE_ENCRYPTION_ENABLED) {
    throw new Error("PostgreSQL backend storage requires HIGHSTATE_ENCRYPTION_ENABLED=true")
  }

  if (!config.HIGHSTATE_BACKEND_DATABASE_POSTGRESQL_URL) {
    throw new Error("PostgreSQL backend storage requires HIGHSTATE_BACKEND_DATABASE_POSTGRESQL_URL")
  }

  if (
    !config.HIGHSTATE_BACKEND_DATABASE_IDENTITY &&
    !config.HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH
  ) {
    throw new Error(
      "PostgreSQL backend storage requires a stable backend AGE identity or identity path",
    )
  }

  const identity = await getOrCreateBackendIdentity(config, logger)
  const recipient = await identityToRecipient(identity)
  const url = new URL(config.HIGHSTATE_BACKEND_DATABASE_POSTGRESQL_URL)

  const database = new BackendDatabase({
    adapter: new PrismaPg(
      { connectionString: url.toString() },
      { schema: url.searchParams.get("schema") ?? "public" },
    ),
  })

  try {
    const keys = await database.$transaction(
      async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${startupLock})`
        // raw bootstrap queries and Prisma's qualified model queries must use the same schema
        const schema = url.searchParams.get("schema") ?? "public"
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema.replaceAll('"', '""')}"`)

        await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "_highstate_backend" (
        "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
        "version" INTEGER NOT NULL CHECK ("version" >= 0),
        "privateKey" TEXT NOT NULL
      )`)

        const [metadata] = await tx.$queryRaw<BackendMetadata[]>`
        SELECT "version", "privateKey" FROM "_highstate_backend" WHERE "id" = 1
      `

        const keys = metadata
          ? await readBackendPrivateKey(metadata.privateKey, identity)
          : await createBackendPrivateKey(identity)

        if (!metadata && "encryptedPrivateKey" in keys) {
          await tx.$executeRaw`
          INSERT INTO "_highstate_backend" ("id", "version", "privateKey")
          VALUES (1, 0, ${keys.encryptedPrivateKey})
        `
        }

        // reuse the migration runner inside this already locked transaction, without nesting transactions
        await migrateDatabase(
          {
            $transaction: async callback => await callback(tx),
            $executeRawUnsafe: async sql => await tx.$executeRawUnsafe(sql),
          },
          migrationPacks["backend/postgresql"],
          metadata?.version ?? 0,
          async (version, migrationTx) => {
            await migrationTx.$executeRawUnsafe(
              `UPDATE "_highstate_backend" SET "version" = ${version} WHERE "id" = 1`,
            )
          },
          logger,
        )

        if (!metadata) {
          await tx.backendUnlockMethod.create({
            data: { recipient, meta: getInitialBackendUnlockMethodMeta(hostname()) },
          })
        }

        return keys
      },
      { timeout: 120_000, maxWait: 120_000 },
    )

    await ensureWellKnownEntitiesCreated(database)
    logger.info({ backendId: keys.backendId }, "opened postgresql backend database")

    return new PostgresqlBackendDatabaseBackend(
      database,
      keys.backendId,
      keys.privateKey,
      identity,
      url.searchParams.get("schema") ?? "public",
    )
  } catch (error) {
    await database.$disconnect()
    throw new Error("Failed to initialize PostgreSQL backend storage", { cause: error })
  }
}

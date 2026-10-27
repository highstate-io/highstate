import type { Logger } from "pino"
import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { resolve as importMetaResolve } from "import-meta-resolve"
import { DatabaseVersionUnsupportedError } from "../shared"

export interface MigrationClient {
  $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>
  $executeRawUnsafe(query: string): Promise<number>
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>
}

export type MigrationPack = {
  type: "backend" | "project"
  schemaPath: string
  migrationNames: string[]
}

export const migrationPacks = {
  "backend/sqlite": {
    type: "backend" as const,
    schemaPath: "backend/sqlite",
    migrationNames: [
      //
      "20250928124105_initial_migration",
      "20260222113554_add_object_tracking",
      "20260503160615_add_entity_sharing_system",
      "20260823193137_add_authorization",
      "20261025160007_runtime_redesign",
    ],
  },
  project: {
    type: "project" as const,
    schemaPath: "project",
    migrationNames: [
      //
      "20250928130725_initial_migration",
      "20260123000000_add_instance_state_self_hash",
      "20260301210131_add_entity_tracking",
      "20260302212734_add_resource_hooks_flag",
      "20260720230553_add_panels",
      "20260822154433_add_passkey_identity",
      "20260823193150_add_authorization",
      "20261025160007_project_library_snapshots",
      "20261025161204_record_initial_library_selection",
    ],
  },
}

export const backendDatabaseVersion = migrationPacks["backend/sqlite"].migrationNames.length
export const projectDatabaseVersion = migrationPacks.project.migrationNames.length

export async function migrateDatabase(
  client: MigrationClient,
  migrationPack: MigrationPack,
  currentVersion: number,
  writeVersion: (version: number) => Promise<void>,
  logger: Logger,
): Promise<void> {
  const { type, schemaPath, migrationNames } = migrationPack
  const targetVersion = migrationNames.length

  const backendIndexPath = importMetaResolve("@highstate/backend", import.meta.url)
  const backendRootPath = join(dirname(fileURLToPath(backendIndexPath)), "..")
  const migrationsDir = resolve(backendRootPath, `prisma`, schemaPath, "migrations")

  logger.debug(`migrations dir: "%s"`, migrationsDir)

  if (currentVersion > targetVersion) {
    throw new DatabaseVersionUnsupportedError(type, currentVersion, targetVersion)
  }

  for (let version = currentVersion; version < migrationNames.length; version++) {
    const nextVersion = version + 1
    const nextMigrationName = migrationNames[nextVersion - 1]

    logger.info(
      `applying migration for %s database, %d -> %d: %s`,
      type,
      version,
      nextVersion,
      nextMigrationName,
    )

    const migrationPath = join(migrationsDir, nextMigrationName, "migration.sql")
    const content = await readFile(migrationPath, "utf-8")

    const statements = splitToStatements(content)

    // SQLite ignores foreign_keys changes inside transactions; table rebuilds would otherwise
    // cascade deletions into referencing tables, even when the replacement preserves every key.
    const rebuildsTables = /PRAGMA\s+foreign_keys\s*=\s*OFF/i.test(content)
    if (rebuildsTables) {
      await client.$executeRawUnsafe("PRAGMA foreign_keys=OFF")
    }

    try {
      await client.$transaction(async tx => {
        const transaction = tx as MigrationClient
        for (const statement of statements) {
          if (/^PRAGMA\s+(foreign_keys|defer_foreign_keys)\s*=/i.test(statement)) {
            continue
          }
          await transaction.$executeRawUnsafe(statement)
        }

        const violations = await transaction.$queryRawUnsafe<unknown[]>("PRAGMA foreign_key_check")
        if (violations.length > 0) {
          throw new Error(`Migration "${nextMigrationName}" violates foreign key constraints`)
        }
        await writeVersion(nextVersion)
      })
    } finally {
      if (rebuildsTables) {
        await client.$executeRawUnsafe("PRAGMA foreign_keys=ON")
      }
    }
  }

  logger.info(`database is up to date at version %d`, migrationNames.length)
}

function splitToStatements(sql: string): string[] {
  const statements: string[] = []
  let currentStatement = ""
  let insideString = false
  let stringChar = ""

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]
    if ((char === "'" || char === '"') && !insideString) {
      insideString = true
      stringChar = char
    } else if (char === stringChar && insideString) {
      insideString = false
      stringChar = ""
    }

    if (char === ";" && !insideString) {
      if (currentStatement.trim().length > 0) {
        statements.push(currentStatement.trim())
      }

      currentStatement = ""
    } else {
      currentStatement += char
    }
  }

  if (currentStatement.trim().length > 0) {
    statements.push(currentStatement.trim())
  }

  return statements
}

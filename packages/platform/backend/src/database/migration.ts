import type { Logger } from "pino"
import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { resolve as importMetaResolve } from "import-meta-resolve"
import { BackendError } from "../shared"

export type MigrationClient = {
  $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>
  $executeRawUnsafe(query: string): Promise<number>
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
    ],
  },
  project: {
    type: "project" as const,
    schemaPath: "project",
    migrationNames: [
      //
      "20250928130725_initial_migration",
      "20260123000000_add_instance_state_self_hash",
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
    throw new BackendError(
      `The version of the ${type} database (${currentVersion}) is newer than expected (${targetVersion}). Do you need to upgrade Highstate?`,
    )
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

    // execute each statement and update the version in a single transaction
    await client.$transaction(async tx => {
      for (const statement of statements) {
        await (tx as MigrationClient).$executeRawUnsafe(statement)
      }

      await writeVersion(nextVersion)
    })
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

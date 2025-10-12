import type { Logger } from "pino"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { execa } from "execa"
import { resolve } from "import-meta-resolve"
import { detectPackageManager } from "nypm"

export async function migrateDatabase(
  databaseUrl: string,
  schemaPath: "backend/sqlite" | "project",
  masterKey: string | undefined,
  logger: Logger,
): Promise<void> {
  logger.info("applying database migrations")

  const backendIndexPath = resolve("@highstate/backend", import.meta.url)
  const backendRootPath = join(fileURLToPath(backendIndexPath), "..")

  const packageManager = await detectPackageManager(backendRootPath)
  if (!packageManager) {
    throw new Error("Could not detect package manager to run migrations")
  }

  const hasCorepack = await execa`"corepack" --version`.then(() => true).catch(() => false)
  const command = hasCorepack ? `corepack ${packageManager.command}` : packageManager.command

  await execa({
    cwd: backendRootPath,
    env: {
      HIGHSTATE_MIGRATION_DATABASE_SCHEMA_PATH: schemaPath,
      HIGHSTATE_MIGRATION_DATABASE_URL: databaseUrl,
      HIGHSTATE_MIGRATION_DATABASE_ENCRYPTION_KEY: masterKey ?? "",
    },
  })`${command} migrate`
}

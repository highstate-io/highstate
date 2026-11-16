import type { MigrationClient } from "./migration"
import { cuidv2d } from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"
import { z } from "zod"

/**
 * Assigns final identities and concurrency tokens to settings created by the runtime migration.
 */
export async function migrateRuntimeSettingsIdentity(database: MigrationClient): Promise<void> {
  const tables = [
    "ContainerRuntime",
    "PulumiStateBackend",
    "NpmRegistryCredential",
    "ContainerRegistryCredential",
  ] as const

  for (const table of tables) {
    const rows = await database.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "${table}"`)

    for (const row of rows) {
      const id = z.cuid2().length(24).safeParse(row.id).success
        ? row.id
        : cuidv2d(`highstate.runtime-settings.${table}`, row.id)

      await database.$executeRawUnsafe(
        `UPDATE "${table}" SET "id" = ?, "revision" = ? WHERE "id" = ?`,
        id,
        createId(),
        row.id,
      )

      // migration table rebuilds run with foreign-key enforcement disabled
      if (table === "ContainerRuntime" || table === "PulumiStateBackend") {
        const field = table === "ContainerRuntime" ? "containerRuntimeId" : "pulumiStateBackendId"

        await database.$executeRawUnsafe(
          `UPDATE "Project" SET "${field}" = ? WHERE "${field}" = ?`,
          id,
          row.id,
        )
      }
    }
  }
}

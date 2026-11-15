import type { MigrationClient } from "./migration"
import { cuidv2d } from "@highstate/contract"
import { z } from "zod"

/**
 * Replaces prerelease free-form settings IDs while preserving references and native state locations.
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
      if (z.cuid2().length(24).safeParse(row.id).success) {
        continue
      }

      if (table === "ContainerRuntime") {
        const active = await database.$queryRawUnsafe<{ id: string }[]>(
          'SELECT "id" FROM "RuntimeWorkload" WHERE "runtimeId" = ? AND "cleanedUpAt" IS NULL LIMIT 1',
          row.id,
        )

        if (active.length) {
          throw new Error(
            `Clean up workloads on runtime "${row.id}" before upgrading its identifier`,
          )
        }
      }

      const id = cuidv2d(`highstate.runtime-settings.${table}`, row.id)

      const retained =
        table === "ContainerRuntime"
          ? ', "legacyOwnershipLabel" = "id"'
          : table === "PulumiStateBackend"
            ? ', "legacyStateVolumeSuffix" = "id"'
            : ""

      await database.$executeRawUnsafe(
        `UPDATE "${table}" SET "id" = ?${retained} WHERE "id" = ?`,
        id,
        row.id,
      )
    }
  }
}

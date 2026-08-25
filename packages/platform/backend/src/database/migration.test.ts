import { readdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { migrationPacks } from "./migration"

const prismaPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../prisma")

describe("migrationPacks", () => {
  for (const [name, migrationPack] of Object.entries(migrationPacks)) {
    test(`lists every ${name} migration`, async () => {
      const migrationsPath = resolve(prismaPath, migrationPack.schemaPath, "migrations")
      const entries = await readdir(migrationsPath, { withFileTypes: true })
      const migrationNames = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()

      expect(migrationPack.migrationNames).toEqual(migrationNames)
    })
  }
})

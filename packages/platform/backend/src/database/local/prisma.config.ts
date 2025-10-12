import { PrismaLibSQL } from "@prisma/adapter-libsql"
import { defineConfig } from "prisma/config"

if (!process.env.HIGHSTATE_MIGRATION_DATABASE_SCHEMA_PATH) {
  throw new Error("HIGHSTATE_MIGRATION_DATABASE_SCHEMA_PATH is not set")
}

export default defineConfig({
  experimental: {
    adapter: true,
  },

  schema: `../../../prisma/${process.env.HIGHSTATE_MIGRATION_DATABASE_SCHEMA_PATH}`,

  async adapter() {
    if (!process.env.HIGHSTATE_MIGRATION_DATABASE_URL) {
      throw new Error("HIGHSTATE_MIGRATION_DATABASE_URL is not set")
    }

    return new PrismaLibSQL({
      url: process.env.HIGHSTATE_MIGRATION_DATABASE_URL,
      encryptionKey: process.env.HIGHSTATE_MIGRATION_DATABASE_ENCRYPTION_KEY || undefined,
    })
  },
})

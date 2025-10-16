import { defineEntity, defineUnit, type z } from "@highstate/contract"
import { sharedArgs, sharedInputs, sharedSchema, sharedSecrets } from "./shared"

/**
 * Represents the PostgreSQL database or virtual database behind it.
 */
export const postgresqlEntity = defineEntity({
  type: "databases.postgresql.v1",

  schema: sharedSchema,

  meta: {
    color: "#336791",
  },
})

/**
 * The existing PostgreSQL database or virtual database behind it.
 */
export const existingPostgresql = defineUnit({
  type: "databases.postgresql.existing.v1",

  args: sharedArgs,
  secrets: sharedSecrets,
  inputs: sharedInputs,

  outputs: {
    postgresql: postgresqlEntity,
  },

  source: {
    package: "@highstate/common",
    path: "units/databases/existing-postgresql",
  },

  meta: {
    title: "Existing PostgreSQL Database",
    icon: "simple-icons:postgresql",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

export type PostgreSQL = z.infer<typeof postgresqlEntity.schema>

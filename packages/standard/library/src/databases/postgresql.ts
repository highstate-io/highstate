import { defineEntity, defineUnit, z } from "@highstate/contract"
import { l4EndpointEntity } from "../network"
import { toPatchArgs } from "../utils"
import { optionalSharedArgs, sharedArgs, sharedInputs, sharedSchema, sharedSecrets } from "./shared"

/**
 * Represents the PostgreSQL database or virtual database behind it.
 */
export const postgresqlEntity = defineEntity({
  type: "databases.postgresql.v1",

  includes: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

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

/**
 * Patches some properties of the PostgreSQL database and outputs the updated database.
 */
export const postgresqlPatch = defineUnit({
  type: "databases.postgresql-patch.v1",

  args: {
    ...toPatchArgs(optionalSharedArgs),

    /**
     * The endpoints to connect to the database in form of `host:port`.
     *
     * If at least one endpoint is provided (either via args or inputs), the existing endpoints
     * will be replaced completely.
     */
    endpoints: z.string().array().default([]),
  },

  inputs: {
    postgresql: postgresqlEntity,
    ...sharedInputs,
  },

  outputs: {
    postgresql: postgresqlEntity,
  },

  source: {
    package: "@highstate/common",
    path: "units/databases/postgresql-patch",
  },

  meta: {
    title: "PostgreSQL Patch",
    icon: "simple-icons:postgresql",
    secondaryIcon: "fluent:patch-20-filled",
    category: "Databases",
  },
})

export type PostgreSQL = z.infer<typeof postgresqlEntity.schema>

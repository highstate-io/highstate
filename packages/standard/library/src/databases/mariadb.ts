import { defineEntity, defineUnit, type EntityInput, z } from "@highstate/contract"
import { l4EndpointEntity } from "../network"
import { toPatchArgs } from "../utils"
import { optionalSharedArgs, sharedArgs, sharedInputs, sharedSchema, sharedSecrets } from "./shared"

/**
 * Represents the MariaDB database or virtual database behind it.
 */
export const mariadbEntity = defineEntity({
  type: "databases.mariadb.v1",

  includes: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: sharedSchema,

  meta: {
    color: "#f06292",
  },
})

/**
 * The existing MariaDB database or virtual database behind it.
 */
export const existingMariadb = defineUnit({
  type: "databases.mariadb.existing.v1",

  args: sharedArgs,
  secrets: sharedSecrets,
  inputs: sharedInputs,

  outputs: {
    mariadb: mariadbEntity,
  },

  source: {
    package: "@highstate/common",
    path: "units/databases/existing-mariadb",
  },

  meta: {
    title: "Existing MariaDB Database",
    icon: "simple-icons:mariadb",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

/**
 * Patches some properties of the MariaDB database and outputs the updated database.
 */
export const mariadbPatch = defineUnit({
  type: "databases.mariadb-patch.v1",

  args: {
    ...toPatchArgs(optionalSharedArgs),

    endpoints: {
      ...sharedArgs.endpoints,
      schema: z.string().array().default([]),
    },
  },

  inputs: {
    mariadb: mariadbEntity,
    ...sharedInputs,
  },

  outputs: {
    mariadb: mariadbEntity,
  },

  source: {
    package: "@highstate/common",
    path: "units/databases/mariadb-patch",
  },

  meta: {
    title: "MariaDB Patch",
    icon: "simple-icons:mariadb",
    secondaryIcon: "fluent:patch-20-filled",
    category: "Databases",
  },
})

export type MariaDB = z.infer<typeof mariadbEntity.schema>
export type MariaDBInput = EntityInput<typeof mariadbEntity>

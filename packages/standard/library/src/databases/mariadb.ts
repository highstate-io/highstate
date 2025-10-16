import { defineEntity, defineUnit, type z } from "@highstate/contract"
import { sharedArgs, sharedInputs, sharedSchema, sharedSecrets } from "./shared"

/**
 * Represents the MariaDB database or virtual database behind it.
 */
export const mariadbEntity = defineEntity({
  type: "databases.mariadb.v1",

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

export type MariaDB = z.infer<typeof mariadbEntity.schema>

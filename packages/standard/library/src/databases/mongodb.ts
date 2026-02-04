import { defineEntity, defineUnit, type EntityInput, z } from "@highstate/contract"
import { l4EndpointEntity } from "../network"
import { toPatchArgs } from "../utils"
import { optionalSharedArgs, sharedArgs, sharedInputs, sharedSchema, sharedSecrets } from "./shared"

/**
 * Represents the MongoDB database or virtual database behind it.
 */
export const mongodbEntity = defineEntity({
  type: "databases.mongodb.v1",

  includes: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: sharedSchema,

  meta: {
    color: "#13aa52",
  },
})

/**
 * The existing MongoDB database or virtual database behind it.
 */
export const existingMongodb = defineUnit({
  type: "databases.mongodb.existing.v1",

  args: sharedArgs,
  secrets: sharedSecrets,
  inputs: sharedInputs,

  outputs: {
    mongodb: mongodbEntity,
  },

  source: {
    package: "@highstate/common",
    path: "units/databases/existing-mongodb",
  },

  meta: {
    title: "Existing MongoDB Database",
    icon: "simple-icons:mongodb",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

/**
 * Patches some properties of the MongoDB database and outputs the updated database.
 */
export const mongodbPatch = defineUnit({
  type: "databases.mongodb-patch.v1",

  args: {
    ...toPatchArgs(optionalSharedArgs),

    endpoints: {
      ...sharedArgs.endpoints,
      schema: z.string().array().default([]),
    },
  },

  inputs: {
    mongodb: mongodbEntity,
    ...sharedInputs,
  },

  outputs: {
    mongodb: mongodbEntity,
  },

  source: {
    package: "@highstate/common",
    path: "units/databases/mongodb-patch",
  },

  meta: {
    title: "MongoDB Patch",
    icon: "simple-icons:mongodb",
    secondaryIcon: "fluent:patch-20-filled",
    category: "Databases",
  },
})

export type MongoDB = z.infer<typeof mongodbEntity.schema>
export type MongoDBInput = EntityInput<typeof mongodbEntity>

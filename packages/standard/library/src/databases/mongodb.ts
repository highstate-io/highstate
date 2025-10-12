import { defineEntity, defineUnit, type z } from "@highstate/contract"
import { sharedArgs, sharedInputs, sharedSchema, sharedSecrets } from "./shared"

/**
 * Represents the MongoDB database or virtual database behind it.
 */
export const mongodbEntity = defineEntity({
  type: "databases.mongodb.v1",

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
})

export type MongoDB = z.infer<typeof mongodbEntity.schema>

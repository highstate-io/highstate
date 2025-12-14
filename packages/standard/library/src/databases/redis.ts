import { defineEntity, defineUnit, z } from "@highstate/contract"
import { sharedArgs, sharedInputs, sharedSchema } from "./shared"

/**
 * Represents the Redis database or virtual database behind it.
 */
export const redisEntity = defineEntity({
  type: "databases.redis.v1",

  schema: sharedSchema.pick({ endpoints: true }).extend({
    /**
     * The number of the database to use.
     */
    database: z.number().default(0),
  }),

  meta: {
    color: "#dc382d",
  },
})

/**
 * The existing Redis database or virtual database behind it.
 */
export const existingRedis = defineUnit({
  type: "databases.redis.existing.v1",

  args: sharedArgs,
  inputs: sharedInputs,

  outputs: {
    redis: redisEntity,
  },

  source: {
    package: "@highstate/common",
    path: "units/databases/existing-redis",
  },

  meta: {
    title: "Existing Redis Database",
    icon: "simple-icons:redis",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

export type Redis = z.infer<typeof redisEntity.schema>

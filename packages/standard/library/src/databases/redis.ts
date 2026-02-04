import { defineEntity, defineUnit, type EntityInput, z } from "@highstate/contract"
import { l4EndpointEntity } from "../network"
import { toPatchArgs } from "../utils"
import { optionalSharedArgs, sharedArgs, sharedInputs } from "./shared"

/**
 * Represents the Redis database or virtual database behind it.
 */
export const redisEntity = defineEntity({
  type: "databases.redis.v1",

  includes: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: z.object({
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

/**
 * Patches some properties of the Redis database and outputs the updated database.
 */
export const redisPatch = defineUnit({
  type: "databases.redis-patch.v1",

  args: {
    ...toPatchArgs(optionalSharedArgs),

    endpoints: {
      ...sharedArgs.endpoints,
      schema: z.string().array().default([]),
    },
  },

  inputs: {
    redis: redisEntity,
    ...sharedInputs,
  },

  outputs: {
    redis: redisEntity,
  },

  source: {
    package: "@highstate/common",
    path: "units/databases/redis-patch",
  },

  meta: {
    title: "Redis Patch",
    icon: "simple-icons:redis",
    secondaryIcon: "fluent:patch-20-filled",
    category: "Databases",
  },
})

export type Redis = z.infer<typeof redisEntity.schema>
export type RedisInput = EntityInput<typeof redisEntity>

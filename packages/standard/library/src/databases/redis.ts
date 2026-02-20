import { defineEntity, defineUnit, type EntityInput, z } from "@highstate/contract"
import { l4EndpointEntity } from "../network"

export const credentialsSchema = z.object({
  /**
   * The username used to authenticate against the database.
   */
  username: z.string().optional(),

  /**
   * The password used to authenticate against the database.
   */
  password: z.string().optional(),
})

export const databaseNumberSchema = z.number().nonnegative().max(15)

/**
 * Represents a connection to a Redis instance, including the endpoints and credentials.
 */
export const connectionEntity = defineEntity({
  type: "redis.connection.v1",

  includes: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: z.object({
    /**
     * The credentials for authenticating to the Redis instance.
     */
    credentials: credentialsSchema.optional(),
  }),

  meta: {
    color: "#dc382d",
  },
})

/**
 * The existing Redis connection hosted on a server or a managed service.
 */
export const connection = defineUnit({
  type: "redis.connection.existing.v1",

  args: {
    /**
     * The username to authenticate with.
     */
    username: z.string().optional(),

    /**
     * The endpoints to connect to the database in form of `host:port`.
     */
    endpoints: z.string().array().default([]),
  },

  inputs: {
    /**
     * The endpoints to connect to the database.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },
  },

  secrets: {
    /**
     * The password to authenticate with.
     */
    password: z.string().optional(),
  },

  outputs: {
    connection: connectionEntity,
  },

  source: {
    package: "@highstate/redis",
    path: "units/connection",
  },

  meta: {
    title: "Redis Connection",
    icon: "simple-icons:redis",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

/**
 * Represents a Redis database with endpoints and configuration to access it.
 */
export const databaseEntity = defineEntity({
  type: "redis.database.v1",

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
    database: databaseNumberSchema.default(0),

    /**
     * The credentials that can be used to access the database.
     */
    credentials: credentialsSchema.optional(),
  }),

  meta: {
    color: "#dc382d",
  },
})

/**
 * Selects a database on a Redis instance.
 */
export const database = defineUnit({
  type: "redis.database.v1",

  args: {
    /**
     * The number of the database to use.
     */
    database: databaseNumberSchema.default(0),
  },

  inputs: {
    /**
     * The connection to the Redis instance.
     */
    connection: connectionEntity,
  },

  outputs: {
    database: databaseEntity,
  },

  meta: {
    title: "Redis Database",
    icon: "simple-icons:redis",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },

  source: {
    package: "@highstate/redis",
    path: "units/database",
  },
})

export type Connection = z.infer<typeof connectionEntity.schema>
export type ConnectionInput = EntityInput<typeof connectionEntity>

export type Database = z.infer<typeof databaseEntity.schema>
export type DatabaseInput = EntityInput<typeof databaseEntity>

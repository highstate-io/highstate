import { defineEntity, defineUnit, type EntityInput, z } from "@highstate/contract"
import { l4EndpointEntity } from "../network"

export const credentialsSchema = z.object({
  /**
   * The username used to authenticate against the database.
   */
  username: z.string(),

  /**
   * The password used to authenticate against the database.
   */
  password: z.string(),
})

/**
 * Represents a connection to a MongoDB instance, including the endpoints and credentials.
 */
export const connectionEntity = defineEntity({
  type: "mongodb.connection.v1",

  includes: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: z.object({
    /**
     * The credentials for authenticating to the MongoDB instance.
     */
    credentials: credentialsSchema,
  }),

  meta: {
    color: "#13aa52",
  },
})

/**
 * The existing MongoDB connection hosted on a server or a managed service.
 */
export const connection = defineUnit({
  type: "mongodb.connection.existing.v1",

  args: {
    /**
     * The username to authenticate with.
     */
    username: z.string(),

    /**
     * The endpoints to connect to the MongoDB instance in form of `host:port`.
     */
    endpoints: z.string().array().default([]),
  },

  inputs: {
    /**
     * The endpoints to connect to the MongoDB instance.
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
    password: z.string(),
  },

  outputs: {
    connection: connectionEntity,
  },

  source: {
    package: "@highstate/mongodb",
    path: "units/connection",
  },

  meta: {
    title: "MongoDB Connection",
    icon: "simple-icons:mongodb",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

/**
 * Represents a MongoDB database with credentials and endpoints to access it.
 */
export const databaseEntity = defineEntity({
  type: "mongodb.database.v1",

  includes: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: z.object({
    /**
     * The name of the MongoDB database.
     */
    name: z.string(),

    /**
     * The credentials that can be used to access the database.
     */
    credentials: credentialsSchema,
  }),

  meta: {
    color: "#13aa52",
  },
})

/**
 * Creates a database in a MongoDB instance.
 */
export const database = defineUnit({
  type: "mongodb.database.v1",

  args: {
    /**
     * The name of the database.
     *
     * If not provided, it will be set to the unit name.
     */
    databaseName: z.string().optional(),

    /**
     * The username to create.
     *
     * If not provided, it will be set to the database name.
     */
    username: z.string().optional(),
  },

  inputs: {
    /**
     * The connection to the MongoDB instance where the database should be created.
     */
    connection: connectionEntity,
  },

  secrets: {
    /**
     * The password of the created user.
     *
     * If not provided, a random password will be generated.
     */
    password: z.string().optional(),
  },

  outputs: {
    database: databaseEntity,
  },

  meta: {
    title: "MongoDB Database",
    icon: "simple-icons:mongodb",
    secondaryIcon: "mdi:database-plus",
    category: "Databases",
  },

  source: {
    package: "@highstate/mongodb",
    path: "units/database",
  },
})

export type Connection = z.infer<typeof connectionEntity.schema>
export type ConnectionInput = EntityInput<typeof connectionEntity>

export type Database = z.infer<typeof databaseEntity.schema>
export type DatabaseInput = EntityInput<typeof databaseEntity>

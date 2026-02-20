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
 * Represents a connection to a PostgreSQL instance, including the endpoints and credentials.
 */
export const connectionEntity = defineEntity({
  type: "postgresql.connection.v1",

  includes: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: z.object({
    /**
     * The credentials for authenticating to the PostgreSQL instance.
     */
    credentials: credentialsSchema,
  }),

  meta: {
    color: "#336791",
  },
})

/**
 * The existing PostgreSQL connection hosted on a server or a managed service.
 */
export const connection = defineUnit({
  type: "postgresql.connection.existing.v1",

  args: {
    /**
     * The username to authenticate with.
     */
    username: z.string(),

    /**
     * The endpoints to connect to the PostgreSQL instance in form of `host:port`.
     */
    endpoints: z.string().array().default([]),
  },

  inputs: {
    /**
     * The endpoints to connect to the PostgreSQL instance.
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
    package: "@highstate/postgresql",
    path: "units/connection",
  },

  meta: {
    title: "PostgreSQL Connection",
    icon: "simple-icons:postgresql",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

/**
 * Represents a PostgreSQL database with credentials and endpoints to access it.
 */
export const databaseEntity = defineEntity({
  type: "postgresql.database.v1",

  includes: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: z.object({
    /**
     * The name of the PostgreSQL database.
     */
    name: z.string(),

    /**
     * The credentials that can be used to access the database.
     */
    credentials: credentialsSchema,
  }),

  meta: {
    color: "#336791",
  },
})

/**
 * Creates a database in a PostgreSQL instance.
 */
export const database = defineUnit({
  type: "postgresql.database.v1",

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
     * The connection to the PostgreSQL instance where the database should be created.
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
    title: "PostgreSQL Database",
    icon: "simple-icons:postgresql",
    secondaryIcon: "mdi:database-plus",
    category: "Databases",
  },

  source: {
    package: "@highstate/postgresql",
    path: "units/database",
  },
})

export type Connection = z.infer<typeof connectionEntity.schema>
export type ConnectionInput = EntityInput<typeof connectionEntity>

export type Database = z.infer<typeof databaseEntity.schema>
export type DatabaseInput = EntityInput<typeof databaseEntity>

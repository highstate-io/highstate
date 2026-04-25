import {
  defineEntity,
  defineUnit,
  type EntityInput,
  type EntityValue,
  secretSchema,
  z,
} from "@highstate/contract"
import { l4EndpointContainer, l4EndpointEntity } from "../network"
import { certificateEntity } from "../tls"

export const credentialsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("password"),

    /**
     * The username used to authenticate against the database.
     */
    username: z.string(),

    /**
     * The password used to authenticate against the database.
     */
    password: secretSchema(z.string()),
  }),
])

/**
 * Represents a connection to a MySQL instance, including the endpoints and credentials.
 */
export const connectionEntity = defineEntity({
  type: "mysql.connection.v1",

  extends: { l4EndpointContainer },

  includes: {
    /**
     * The TLS certificate of the server if any.
     */
    certificate: {
      entity: certificateEntity,
      required: false,
    },
  },

  schema: z.object({
    /**
     * The credentials for authenticating to the MySQL instance.
     */
    credentials: credentialsSchema,

    /**
     * The optional name of the database to operate on.
     */
    database: z.string().optional(),
  }),

  meta: {
    color: "#f06292",
  },
})

/**
 * The existing MySQL connection hosted on a server or a managed service.
 */
export const connection = defineUnit({
  type: "mysql.connection.v1",

  args: {
    /**
     * The username to authenticate with.
     */
    username: z.string(),

    /**
     * The endpoints to connect to the MySQL instance in form of `host:port`.
     */
    endpoints: z.string().array().default([]),
  },

  inputs: {
    /**
     * The endpoints to connect to the MySQL instance.
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
    package: "@highstate/mysql",
    path: "units/connection",
  },

  meta: {
    title: "MySQL Connection",
    icon: "simple-icons:mysql",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

/**
 * Creates a database in a MySQL instance.
 */
export const database = defineUnit({
  type: "mysql.database.v1",

  args: {
    /**
     * The name of the database.
     *
     * If not provided, it will be set to the unit name.
     */
    databaseName: z.string().optional(),

    /**
     * The username of the database admin user to create.
     *
     * If not provided, it will be set to the database name.
     */
    username: z.string().optional(),
  },

  inputs: {
    /**
     * The connection to the MySQL instance where the database should be created.
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
    connection: connectionEntity,
  },

  meta: {
    title: "MySQL Database",
    icon: "simple-icons:mysql",
    secondaryIcon: "mdi:database-plus",
    category: "Databases",
  },

  source: {
    package: "@highstate/mysql",
    path: "units/database",
  },
})

export type Connection = EntityValue<typeof connectionEntity>
export type ConnectionInput = EntityInput<typeof connectionEntity>

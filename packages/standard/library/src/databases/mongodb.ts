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
 * Represents a connection to a MongoDB instance, including the endpoints and credentials.
 */
export const connectionEntity = defineEntity({
  type: "mongodb.connection.v1",

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
     * The credentials for authenticating to the MongoDB instance.
     */
    credentials: credentialsSchema,

    /**
     * The name of the database to operate on.
     */
    database: z.string().optional(),
  }),

  meta: {
    color: "#13aa52",
  },
})

/**
 * The existing MongoDB connection hosted on a server or a managed service.
 */
export const connection = defineUnit({
  type: "mongodb.connection.v1",

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
    connection: connectionEntity,
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

export type Connection = EntityValue<typeof connectionEntity>
export type ConnectionInput = EntityInput<typeof connectionEntity>

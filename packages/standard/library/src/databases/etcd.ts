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

/**
 * The credentials for authenticating to the etcd cluster.
 */
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
 * Represents a connection to the etcd cluster.
 */
export const connectionEntity = defineEntity({
  type: "etcd.connection.v1",

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
     * The credentials for authenticating to the etcd cluster.
     */
    credentials: credentialsSchema.optional(),
  }),

  meta: {
    color: "#0064bf",
  },
})

/**
 * The connection to an existing etcd cluster hosted on a server or a managed service.
 */
export const connection = defineUnit({
  type: "etcd.connection.v1",

  args: {
    /**
     * The endpoints to connect to the etcd cluster.
     */
    endpoints: z.string().array().default([]),

    /**
     * The username to authenticate with.
     */
    username: z.string().optional(),
  },

  secrets: {
    /**
     * The password to authenticate with.
     */
    password: z.string().optional(),
  },

  inputs: {
    /**
     * The endpoints to connect to the etcd cluster.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    connection: connectionEntity,
  },

  source: {
    package: "@highstate/etcd",
    path: "units/connection",
  },

  meta: {
    title: "Existing etcd Database",
    icon: "simple-icons:etcd",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

export const namespacePermissionSchema = z.object({
  /**
   * The prefix of the namespace to grant access to.
   */
  prefix: z.string(),

  /**
   * The range end of the namespace to grant access to.
   *
   * If not specified, all keys with the given prefix will be included in the namespace.
   */
  rangeEnd: z.string().optional(),

  /**
   * The access level to grant to the namespace.
   *
   * If not specified, defaults to `readwrite`.
   */
  permission: z.enum(["read", "write", "readwrite"]).default("readwrite"),
})

/**
 * The namespace within an existing etcd cluster.
 */
export const namespace = defineUnit({
  type: "etcd.namespace.v1",

  args: {
    /**
     * The name of the role to define for the namespace.
     *
     * If not provided, the name of the unit will be used.
     */
    roleName: z.string().optional(),

    /**
     * The username of the user to create for the namespace.
     *
     * If not provided, the name of the role will be used.
     */
    username: z.string().optional(),

    /**
     * The permissions to grant to the namespace.
     */
    permissions: namespacePermissionSchema.array(),
  },

  secrets: {
    /**
     * The password of the user to create for the namespace.
     *
     * If not provided, a random password will be generated.
     */
    password: z.string().optional(),
  },

  inputs: {
    /**
     * The connection to the etcd cluster.
     */
    connection: {
      entity: connectionEntity,
      required: true,
    },
  },

  outputs: {
    connection: connectionEntity,
  },

  source: {
    package: "@highstate/etcd",
    path: "units/namespace",
  },

  meta: {
    title: "etcd Namespace",
    icon: "simple-icons:etcd",
    iconColor: "#0069ab",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

export type Credentials = z.infer<typeof credentialsSchema>

export type Connection = EntityValue<typeof connectionEntity>
export type ConnectionInput = EntityInput<typeof connectionEntity>

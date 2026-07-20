import {
  defineEntity,
  defineUnit,
  type EntityInput,
  type EntityValue,
  secretSchema,
  z,
} from "@highstate/contract"
import { fileEntity } from "../common"
import { l7EndpointContainer, l7EndpointEntity } from "../network"
import { bucketEntity } from "./s3"

export const credentialsSchema = z.object({
  /**
   * The access key used to authenticate against RustFS.
   */
  accessKey: z.string(),

  /**
   * The secret key used to authenticate against RustFS.
   */
  secretKey: secretSchema(z.string()),
})

/**
 * Represents a connection to a RustFS instance.
 */
export const connectionEntity = defineEntity({
  type: "rustfs.connection.v1",

  extends: { l7EndpointContainer },

  includes: {
    /**
     * The CA certificate file used to verify the server if any.
     */
    ca: {
      entity: fileEntity,
      required: false,
    },
  },

  schema: z.object({
    /**
     * The S3 region of the RustFS instance.
     */
    region: z.string(),

    /**
     * The credentials for authenticating to RustFS.
     */
    credentials: credentialsSchema,
  }),

  meta: {
    color: "#D34516",
  },
})

/**
 * An existing RustFS connection hosted on a server or Kubernetes cluster.
 */
export const connection = defineUnit({
  type: "rustfs.connection.v1",

  args: {
    /**
     * The access key to authenticate with.
     */
    accessKey: z.string(),

    /**
     * The S3 region of the RustFS instance.
     */
    region: z.string().default("us-east-1"),

    /**
     * The endpoints to connect to the RustFS instance.
     */
    endpoints: z.string().array().default([]),
  },

  inputs: {
    /**
     * The endpoints to connect to the RustFS instance.
     */
    endpoints: {
      entity: l7EndpointEntity,
      multiple: true,
      required: false,
    },

    /**
     * The CA certificate file used to verify the server if any.
     */
    ca: {
      entity: fileEntity,
      required: false,
    },
  },

  secrets: {
    /**
     * The secret key to authenticate with.
     */
    secretKey: z.string(),
  },

  outputs: {
    connection: connectionEntity,
  },

  source: {
    package: "@highstate/rustfs",
    path: "connection",
  },

  meta: {
    title: "RustFS Connection",
    icon: "simple-icons:rust",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

/**
 * Creates a bucket and bucket-scoped service account on a RustFS instance.
 */
export const bucket = defineUnit({
  type: "rustfs.bucket.v1",

  args: {
    /**
     * The name of the bucket to create.
     *
     * Defaults to the name of the unit if not provided.
     */
    bucketName: z.string().optional(),
  },

  inputs: {
    /**
     * The RustFS instance where the bucket should be created.
     */
    connection: connectionEntity,
  },

  outputs: {
    /**
     * The created S3-compatible bucket with scoped credentials.
     */
    bucket: bucketEntity,
  },

  source: {
    package: "@highstate/rustfs",
    path: "bucket",
  },

  meta: {
    title: "RustFS Bucket",
    icon: "simple-icons:rust",
    secondaryIcon: "mdi:bucket",
    category: "Databases",
  },
})

export type Connection = EntityValue<typeof connectionEntity>
export type ConnectionInput = EntityInput<typeof connectionEntity>

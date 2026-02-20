import { defineEntity, defineUnit, type EntityInput, z } from "@highstate/contract"
import { l7EndpointEntity } from "../network"
import { bucketEntity } from "./s3"

export const credentialsSchema = z.object({
  /**
   * The username used to authenticate against the API.
   */
  username: z.string(),

  /**
   * The password used to authenticate against the API.
   */
  password: z.string(),
})

/**
 * Represents a connection to a MinIO instance, including the endpoints and credentials.
 */
export const connectionEntity = defineEntity({
  type: "minio.connection.v1",

  includes: {
    endpoints: {
      entity: l7EndpointEntity,
      multiple: true,
    },
  },

  schema: z.object({
    /**
     * The region of the MinIO instance.
     */
    region: z.string(),

    /**
     * The credentials for authenticating to the MinIO instance.
     */
    credentials: credentialsSchema,
  }),
})

/**
 * The existing MinIO connection hosted on a server or a managed service.
 */
export const connection = defineUnit({
  type: "minio.connection.existing.v1",

  args: {
    /**
     * The username to authenticate with.
     */
    username: z.string(),

    /**
     * The region of the MinIO instance.
     *
     * If not provided, it will default to "us-east-1".
     */
    region: z.string().default("us-east-1"),

    /**
     * The endpoints to connect to the MinIO instance.
     */
    endpoints: z.string().array().default([]),
  },

  inputs: {
    /**
     * The endpoints to connect to the MinIO instance.
     */
    endpoints: {
      entity: l7EndpointEntity,
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
    package: "@highstate/minio",
    path: "connection",
  },

  meta: {
    title: "MinIO Connection",
    icon: "simple-icons:minio",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

/**
 * Creates a bucket on a MinIO instance.
 */
export const bucket = defineUnit({
  type: "minio.bucket.v1",

  args: {
    /**
     * The name of the bucket to create.
     *
     * Defaults to the name of the unit if not provided.
     */
    bucketName: z.string().optional(),

    /**
     * The quota for the bucket as string with size suffix, e.g. "10GB". If not provided, the bucket will have no quota.
     */
    quota: z.string().optional(),
  },

  inputs: {
    /**
     * The connection to the MinIO instance where the bucket should be created.
     */
    connection: connectionEntity,
  },

  outputs: {
    /**
     * The created bucket.
     */
    bucket: bucketEntity,
  },

  source: {
    package: "@highstate/minio",
    path: "bucket",
  },

  meta: {
    title: "MinIO Bucket",
    icon: "simple-icons:minio",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

export type Connection = z.infer<typeof connectionEntity.schema>
export type ConnectionInput = EntityInput<typeof connectionEntity>

import { $args, $inputs, $secrets, defineEntity, defineUnit, z } from "@highstate/contract"
import { l4EndpointEntity } from "../network"

export const s3BucketPolicySchema = z.enum(["none", "download", "upload", "public"])

export const s3BucketSchema = z.object({
  /**
   * The name of the bucket.
   */
  name: z.string(),

  /**
   * The optional policy applied to the bucket.
   */
  policy: s3BucketPolicySchema.optional(),
})

const s3Args = $args({
  /**
   * The endpoints to connect to the S3-compatible API in form of `host:port`.
   */
  endpoints: z.string().array().min(1),

  /**
   * The access key used to authenticate against the S3-compatible API.
   */
  accessKey: z.string(),

  /**
   * The region associated with the S3-compatible deployment.
   */
  region: z.string().optional(),

  /**
   * The buckets that must exist on the instance.
   */
  buckets: s3BucketSchema.array().default([]),
})

const s3Secrets = $secrets({
  /**
   * The secret key used to authenticate against the S3-compatible API.
   */
  secretKey: z.string(),
})

const s3Inputs = $inputs({
  /**
   * The endpoints to connect to the S3-compatible API.
   */
  endpoints: {
    entity: l4EndpointEntity,
    multiple: true,
    required: false,
  },
})

/**
 * Represents an S3-compatible object storage endpoint.
 */
export const s3Entity = defineEntity({
  type: "databases.s3.v1",

  schema: z.object({
    /**
     * The endpoints that expose the S3-compatible API.
     */
    endpoints: l4EndpointEntity.schema.array(),

    /**
     * The region associated with the object storage instance.
     */
    region: z.string().optional(),

    /**
     * The access key used to authenticate against the API.
     */
    accessKey: z.string(),

    /**
     * The secret key used to authenticate against the API.
     */
    secretKey: z.string(),

    /**
     * The buckets that must exist on the instance.
     */
    buckets: s3BucketSchema.array(),
  }),

  meta: {
    color: "#ff9900",
  },
})

/**
 * The existing S3-compatible object storage instance.
 */
export const existingS3 = defineUnit({
  type: "databases.s3.existing.v1",

  args: s3Args,
  secrets: s3Secrets,
  inputs: s3Inputs,

  outputs: {
    s3: s3Entity,
  },

  source: {
    package: "@highstate/common",
    path: "units/databases/existing-s3",
  },

  meta: {
    title: "Existing S3-Compatible Storage",
    icon: "simple-icons:amazons3",
    secondaryIcon: "mdi:bucket",
    category: "Databases",
  },
})

export type S3 = z.infer<typeof s3Entity.schema>

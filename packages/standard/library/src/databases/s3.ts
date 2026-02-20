import { defineEntity, defineUnit, type EntityInput, z } from "@highstate/contract"
import { l4EndpointEntity, l7EndpointEntity } from "../network"

export const credentialsSchema = z.object({
  /**
   * The access key used to authenticate against the API.
   */
  accessKey: z.string(),

  /**
   * The secret key used to authenticate against the API.
   */
  secretKey: z.string(),
})

/**
 * Represents an S3 bucket with credentials and endpoints to access it.
 */
export const bucketEntity = defineEntity({
  type: "s3.bucket.v1",

  includes: {
    endpoints: {
      entity: l7EndpointEntity,
      multiple: true,
    },
  },

  schema: z.object({
    /**
     * The name of the S3 bucket.
     */
    name: z.string(),

    /**
     * The region where the S3 bucket is located.
     */
    region: z.string(),

    /**
     * The credentials that can be used to access the S3 bucket.
     */
    credentials: credentialsSchema,
  }),

  meta: {
    color: "#ff9900",
  },
})

/**
 * The existing S3 bucket hosted on AWS or another S3-compatible service.
 */
export const existingBucket = defineUnit({
  type: "s3.bucket.existing.v1",

  args: {
    /**
     * The name of the existing S3 bucket.
     */
    bucketName: z.string(),

    /**
     * The region where the existing S3 bucket is located.
     */
    region: z.string(),

    /**
     * The endpoints to connect to the S3 bucket.
     */
    endpoints: z.string().array().default([]),
  },

  inputs: {
    /**
     * The endpoints to connect to the S3 bucket.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    bucket: bucketEntity,
  },

  source: {
    package: "@highstate/common",
    path: "units/databases/existing-s3-bucket",
  },

  meta: {
    title: "Existing S3 Bucket",
    icon: "simple-icons:amazonaws",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

export type Bucket = z.infer<typeof bucketEntity.schema>
export type BucketInput = EntityInput<typeof bucketEntity>

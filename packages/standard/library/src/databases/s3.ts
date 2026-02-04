import type { Simplify } from "type-fest"
import {
  $args,
  $inputs,
  $secrets,
  defineEntity,
  defineUnit,
  type EntityInput,
  type FullComponentArgumentOptions,
  z,
} from "@highstate/contract"
import { mapValues } from "remeda"
import { l4EndpointEntity } from "../network"
import { toPatchArgs } from "../utils"

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

type ToOptionalArgs<T extends Record<string, FullComponentArgumentOptions>> = Simplify<{
  [K in keyof T]: Simplify<Omit<T[K], "schema"> & { schema: z.ZodOptional<T[K]["schema"]> }>
}>

const optionalS3Args = mapValues(s3Args, arg => ({
  ...arg,
  schema: arg.schema.optional(),
})) as ToOptionalArgs<typeof s3Args>

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

  includes: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: z.object({
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

/**
 * Patches some properties of the S3-compatible object storage and outputs the updated storage.
 */
export const s3Patch = defineUnit({
  type: "databases.s3-patch.v1",

  args: {
    ...toPatchArgs(optionalS3Args),

    endpoints: {
      ...s3Args.endpoints,
      schema: z.string().array().default([]),
    },
  },

  inputs: {
    s3: s3Entity,
    ...s3Inputs,
  },

  outputs: {
    s3: s3Entity,
  },

  source: {
    package: "@highstate/common",
    path: "units/databases/s3-patch",
  },

  meta: {
    title: "S3 Patch",
    icon: "simple-icons:amazons3",
    secondaryIcon: "fluent:patch-20-filled",
    category: "Databases",
  },
})

export type S3 = z.infer<typeof s3Entity.schema>
export type S3Input = EntityInput<typeof s3Entity>

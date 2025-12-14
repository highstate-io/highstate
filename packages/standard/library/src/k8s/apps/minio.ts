import { $secrets, defineUnit, text, z } from "@highstate/contract"
import { pick } from "remeda"
import * as databases from "../../databases"
import { l4EndpointEntity } from "../../network"
import { serviceEntity } from "../service"
import { appName, optionalSharedInputs, sharedArgs, sharedInputs, source } from "./shared"

const minioSecrets = $secrets({
  /**
   * The secret key used to authenticate with MinIO.
   */
  secretKey: z.string().optional(),

  /**
   * The key that protects Restic backups.
   */
  backupKey: z.string().optional(),
})

/**
 * The MinIO object storage deployed on Kubernetes.
 */
export const minio = defineUnit({
  type: "k8s.apps.minio.v1",
  args: {
    ...appName("minio"),
    ...pick(sharedArgs, ["external"]),

    accessKey: {
      schema: z.string().default("admin"),
      meta: {
        description: text`
          The access key used to authenticate with MinIO.
          If not provided, defaults to "admin".
        `,
      },
    },

    region: {
      schema: z.string().optional(),
      meta: {
        description: text`The region associated with the MinIO deployment.`,
      },
    },

    buckets: {
      schema: databases.s3BucketSchema.array().default([]),
      meta: {
        description: text`
          The buckets that must exist on the MinIO instance.
          Each entry can optionally include a bucket policy: none, download, upload, or public.
        `,
      },
    },
  },

  secrets: minioSecrets,

  inputs: {
    ...pick(sharedInputs, ["k8sCluster"]),
    ...pick(optionalSharedInputs, ["resticRepo"]),
  },

  outputs: {
    s3: databases.s3Entity,
    service: serviceEntity,
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  meta: {
    title: "MinIO",
    icon: "simple-icons:minio",
    secondaryIcon: "mdi:bucket",
    category: "Databases",
  },

  source: source("minio/app"),
})

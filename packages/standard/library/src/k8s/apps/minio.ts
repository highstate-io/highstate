import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import {
  appName,
  optionalSharedArgs,
  optionalSharedInputs,
  sharedArgs,
  sharedInputs,
  sharedSecrets,
  source,
} from "./shared"
import { connectionEntity } from "../../databases/minio"
import { deploymentEntity } from "../workload"

/**
 * The MinIO object storage deployed on Kubernetes.
 */
export const minio = defineUnit({
  type: "k8s.apps.minio.v1",

  args: {
    ...appName("minio"),
    ...pick(optionalSharedArgs, ["fqdn"]),
    ...pick(sharedArgs, ["external"]),

    /**
     * The FQDN of the MinIO console.
     *
     * If not provided, the console will not be exposed and only the S3 API will be available.
     */
    consoleFqdn: z.string().optional(),

    /**
     * The name of the region to associate with the MinIO deployment.
     *
     * Defaults to "us-east-1".
     */
    region: z.string().default("us-east-1"),

    /**
     * Whether to use the [fork](https://github.com/huncrys/minio-console) of MinIO Console instead of the built-in console.
     * The fork contains admin features that were removed from the original console.
     */
    useConsoleFork: z.boolean().default(false),
  },

  secrets: {
    ...pick(sharedSecrets, ["adminPassword", "backupKey"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster"]),
    ...pick(optionalSharedInputs, ["accessPoint", "resticRepo"]),
  },

  outputs: {
    connection: connectionEntity,
    deployment: deploymentEntity,
  },

  meta: {
    title: "MinIO",
    icon: "simple-icons:minio",
    secondaryIcon: "mdi:bucket",
    category: "Databases",
  },

  source: source("minio/app"),
})

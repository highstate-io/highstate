import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { connectionEntity } from "../../apps/vault"
import { s3 } from "../../databases"
import { statefulSetEntity } from "../workload"
import {
  appName,
  optionalSharedInputs,
  sharedArgs,
  sharedInputs,
  sharedSecrets,
  source,
} from "./shared"

/**
 * The HashiCorp Vault deployed on Kubernetes using the official Helm chart.
 */
export const vault = defineUnit({
  type: "k8s.apps.vault.v1",

  args: {
    ...appName("vault"),
    ...pick(sharedArgs, ["fqdn", "external", "namespace"]),

    /**
     * The storage backend to use for Vault.
     *
     * The options are:
     * - `file`: uses a persistent volume claim and supports restic backups (default);
     * - `s3`: uses an external S3-compatible bucket; expects `s3Bucket` input.
     */
    backend: z.enum(["file", "s3"]).default("file"),

    /**
     * The automatic Vault initialization configuration.
     */
    autoInit: z
      .object({
        /**
         * Whether to initialize Vault automatically using the Vault CLI.
         */
        enabled: z.boolean().default(true),

        /**
         * The number of unseal key shares to create.
         */
        shares: z.number().int().positive().default(1),

        /**
         * The number of unseal key shares required to unseal Vault.
         */
        threshold: z.number().int().positive().default(1),
      })
      .refine(autoInit => autoInit.threshold <= autoInit.shares, {
        message: "threshold must be less than or equal to shares",
        path: ["threshold"],
      })
      .default({
        enabled: true,
        shares: 1,
        threshold: 1,
      }),
  },

  secrets: {
    ...pick(sharedSecrets, ["backupKey"]),

    /**
     * The root token returned by `vault operator init`.
     */
    rootToken: z.string().optional(),

    /**
     * The unseal key shares returned by `vault operator init`.
     */
    unsealKeys: z.string().array().meta({ complex: true }).optional(),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint"]),

    /**
     * When `backend` is `s3`, supply an existing S3 bucket connection (see `s3.bucketEntity`).
     */
    s3Bucket: {
      entity: s3.bucketEntity,
      required: false, // only required if backend is s3, will validate presence later
    },

    ...pick(optionalSharedInputs, ["resticRepo", "volume"]),
  },

  outputs: {
    connection: connectionEntity,
    statefulSet: statefulSetEntity,
  },

  meta: {
    title: "Vault",
    icon: "simple-icons:vault",
    category: "Security",
  },

  source: source("vault"),
})

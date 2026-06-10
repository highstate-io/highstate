import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
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
  },

  secrets: {
    ...pick(sharedSecrets, ["backupKey"]),
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
    statefulSet: statefulSetEntity,
  },

  meta: {
    title: "Vault",
    icon: "simple-icons:vault",
    category: "Security",
  },

  source: source("vault"),
})

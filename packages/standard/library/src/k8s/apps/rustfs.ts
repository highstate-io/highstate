import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { connectionEntity } from "../../databases/rustfs"
import { workloadEntity } from "../workload"
import {
  appName,
  optionalSharedArgs,
  optionalSharedInputs,
  sharedArgs,
  sharedInputs,
  sharedSecrets,
  source,
} from "./shared"

/**
 * The RustFS S3-compatible object storage deployed on Kubernetes.
 */
export const rustfs = defineUnit({
  type: "k8s.apps.rustfs.v1",

  args: {
    ...appName("rustfs"),
    ...pick(optionalSharedArgs, ["fqdn", "namespace"]),
    ...pick(sharedArgs, ["external", "values", "patches", "service", "scheduling"]),

    /**
     * The deployment topology to use.
     *
     * Standalone mode deploys one pod with one data volume.
     * Distributed mode deploys an erasure-coded StatefulSet across multiple pods and volumes.
     */
    mode: z.enum(["standalone", "distributed"]).default("distributed"),

    /**
     * The FQDN of the RustFS console.
     *
     * If not provided, the console will only be available inside the cluster.
     */
    consoleFqdn: z.string().optional(),

    /**
     * The number of nodes in a distributed deployment.
     *
     * Ignored in standalone mode.
     */
    replicas: z.number().int().min(2).default(4),

    /**
     * The number of data volumes attached to each distributed node.
     *
     * Ignored in standalone mode.
     */
    drivesPerNode: z.number().int().min(1).default(4),

    /**
     * Whether to bypass RustFS validation that each data volume uses a distinct physical disk.
     *
     * This sets `RUSTFS_UNSAFE_BYPASS_DISK_CHECK=true` and must only be used for local testing or CI.
     * Enabling it in production can cause correlated data loss because multiple erasure-coded drives
     * may actually share one physical device.
     */
    unsafeBypassDiskCheck: z.boolean().default(false),

    /**
     * Whether distributed RustFS pods may share Kubernetes nodes.
     *
     * By default, RustFS requires each replica to run on a different node for failure isolation.
     * Enable this when the Kubernetes cluster has fewer eligible nodes than RustFS replicas.
     * Pods will still prefer separate nodes, but the scheduler may place multiple replicas on one node.
     * This reduces fault tolerance because one node failure can make multiple RustFS replicas unavailable.
     *
     * Ignored in standalone mode.
     */
    allowLessNodes: z.boolean().default(false),

    /**
     * The Kubernetes StorageClass used for RustFS volumes.
     */
    storageClass: z.string().default("local-path"),

    /**
     * The requested capacity of each data volume.
     */
    dataStorageSize: z.string().default("100Gi"),

    /**
     * The requested capacity of each log volume.
     */
    logStorageSize: z.string().default("1Gi"),

    /**
     * The S3 region reported by RustFS.
     */
    region: z.string().default("us-east-1"),
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
    workload: workloadEntity,
  },

  meta: {
    title: "RustFS",
    icon: "simple-icons:rust",
    secondaryIcon: "mdi:bucket",
    category: "Databases",
  },

  source: source("rustfs"),
})

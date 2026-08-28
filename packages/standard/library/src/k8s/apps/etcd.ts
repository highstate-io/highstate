import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { connectionEntity } from "../../databases/etcd"
import {
  appName,
  optionalSharedInputs,
  sharedArgs,
  sharedInputs,
  sharedSecrets,
  source,
} from "./shared"

/**
 * The etcd instance deployed on Kubernetes.
 */
export const etcd = defineUnit({
  type: "k8s.apps.etcd.v1",

  args: {
    ...appName("etcd"),
    ...pick(sharedArgs, ["external", "values", "patches", "service", "scheduling"]),

    /**
     * The odd number of etcd members to deploy.
     */
    replicas: z
      .number()
      .int()
      .positive()
      .refine(replicas => replicas % 2 === 1, "etcd replicas must be odd")
      .default(1),
  },

  secrets: {
    ...pick(sharedSecrets, ["backupKey"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster"]),
    ...pick(optionalSharedInputs, ["resticRepo"]),
  },

  outputs: {
    connection: connectionEntity,
  },

  meta: {
    title: "etcd",
    icon: "simple-icons:etcd",
    iconColor: "#0069ab",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },

  source: source("etcd"),
})

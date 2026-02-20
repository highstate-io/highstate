import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import {
  appName,
  optionalSharedInputs,
  sharedArgs,
  sharedInputs,
  sharedSecrets,
  source,
} from "./shared"
import { clusterEntity } from "../../databases/etcd"

/**
 * The etcd instance deployed on Kubernetes.
 */
export const etcd = defineUnit({
  type: "k8s.apps.etcd.v1",

  args: {
    ...appName("etcd"),
    ...pick(sharedArgs, ["external"]),
  },

  secrets: {
    ...pick(sharedSecrets, ["backupKey"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster"]),
    ...pick(optionalSharedInputs, ["resticRepo"]),
  },

  outputs: {
    etcd: clusterEntity,
  },

  meta: {
    title: "etcd",
    icon: "simple-icons:etcd",
    iconColor: "#0069ab",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },

  source: source("etcd/app"),
})

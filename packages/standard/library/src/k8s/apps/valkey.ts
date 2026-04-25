import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { redis } from "../../databases"
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
 * The Valkey instance deployed on Kubernetes.
 */
export const valkey = defineUnit({
  type: "k8s.apps.valkey.v1",

  args: {
    ...appName("valkey"),
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
    connection: redis.connectionEntity,
    statefulSet: statefulSetEntity,
  },

  meta: {
    title: "Valkey (Redis)",
    icon: "simple-icons:redis",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },

  source: source("valkey"),
})

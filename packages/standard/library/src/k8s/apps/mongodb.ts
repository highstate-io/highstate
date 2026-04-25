import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { connectionEntity } from "../../databases/mongodb"
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
 * The MongoDB instance deployed on Kubernetes.
 */
export const mongodb = defineUnit({
  type: "k8s.apps.mongodb.v1",

  args: {
    ...appName("mongodb"),
    ...pick(sharedArgs, ["external"]),
  },

  secrets: {
    ...pick(sharedSecrets, ["adminPassword", "backupKey"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster"]),
    ...pick(optionalSharedInputs, ["resticRepo"]),
  },

  outputs: {
    connection: connectionEntity,
    statefulSet: statefulSetEntity,
  },

  meta: {
    title: "MongoDB",
    icon: "simple-icons:mongodb",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },

  source: source("mongodb"),
})

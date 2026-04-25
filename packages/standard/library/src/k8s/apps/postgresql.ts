import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { connectionEntity } from "../../databases/postgresql"
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
 * The PostgreSQL instance deployed on Kubernetes.
 */
export const postgresql = defineUnit({
  type: "k8s.apps.postgresql.v1",

  args: {
    ...appName("postgresql"),
    ...pick(sharedArgs, ["namespace", "external"]),
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
    title: "PostgreSQL",
    icon: "simple-icons:postgresql",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },

  source: source("postgresql"),
})

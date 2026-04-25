import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { connectionEntity } from "../../databases/mysql"
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
 * The MariaDB database deployed on Kubernetes.
 */
export const mariadb = defineUnit({
  type: "k8s.apps.mariadb.v1",

  args: {
    ...appName("mariadb"),
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
    title: "MariaDB",
    icon: "simple-icons:mariadb",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },

  source: source("mariadb"),
})

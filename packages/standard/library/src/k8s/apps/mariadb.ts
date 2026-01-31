import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import * as databases from "../../databases"
import { serviceEntity } from "../service"
import {
  appName,
  optionalSharedInputs,
  sharedArgs,
  sharedDatabaseArgs,
  sharedDatabaseSecrets,
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
    ...pick(sharedSecrets, ["rootPassword", "backupKey"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster"]),
    ...pick(optionalSharedInputs, ["resticRepo"]),
  },

  outputs: {
    mariadb: databases.mariadbEntity,
    service: serviceEntity,
  },

  meta: {
    title: "MariaDB",
    icon: "simple-icons:mariadb",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },

  source: source("mariadb/app"),
})

/**
 * The virtual MariaDB database created on the MariaDB instance.
 *
 * Requires a Kubernetes cluster to place init jobs and secrets.
 */
export const mariadbDatabase = defineUnit({
  type: "k8s.apps.mariadb.database.v1",

  args: sharedDatabaseArgs,
  secrets: sharedDatabaseSecrets,

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "mariadb"]),
    ...pick(optionalSharedInputs, ["namespace"]),
  },

  outputs: {
    mariadb: databases.mariadbEntity,
  },

  meta: {
    title: "MariaDB Database",
    icon: "simple-icons:mariadb",
    secondaryIcon: "mdi:database-plus",
    category: "Databases",
  },

  source: source("mariadb/database"),
})

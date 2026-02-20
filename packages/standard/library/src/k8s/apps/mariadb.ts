import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { databaseEntity } from "../../databases/mysql"
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
    ...pick(sharedSecrets, ["adminPassword", "backupKey"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster"]),
    ...pick(optionalSharedInputs, ["resticRepo"]),
  },

  outputs: {
    database: databaseEntity,
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
 */
export const mariadbDatabase = defineUnit({
  type: "k8s.apps.mariadb.database.v1",

  args: sharedDatabaseArgs,
  secrets: sharedDatabaseSecrets,

  inputs: {
    mariadb: databaseEntity,
  },

  outputs: {
    mariadb: databaseEntity,
  },

  meta: {
    title: "MariaDB Database",
    icon: "simple-icons:mariadb",
    secondaryIcon: "mdi:database-plus",
    category: "Databases",
  },

  source: source("mariadb/database"),
})

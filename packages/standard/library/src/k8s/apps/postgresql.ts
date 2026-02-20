import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { databaseEntity } from "../../databases/postgresql"
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
 * The PostgreSQL instance deployed on Kubernetes.
 */
export const postgresql = defineUnit({
  type: "k8s.apps.postgresql.v1",

  args: {
    ...appName("postgresql"),
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
    title: "PostgreSQL",
    icon: "simple-icons:postgresql",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },

  source: source("postgresql/app"),
})

/**
 * The virtual PostgreSQL database created on the PostgreSQL instance.
 *
 * The provided database must be authorized to create databases and users.
 */
export const postgresqlDatabase = defineUnit({
  type: "k8s.apps.postgresql.database.v1",

  args: sharedDatabaseArgs,
  secrets: sharedDatabaseSecrets,

  inputs: {
    postgresql: databaseEntity,
  },

  outputs: {
    postgresql: databaseEntity,
  },

  meta: {
    title: "PostgreSQL Database",
    icon: "simple-icons:postgresql",
    secondaryIcon: "mdi:database-plus",
    category: "Databases",
  },

  source: source("postgresql/database"),
})

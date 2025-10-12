import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import * as databases from "../../databases"
import { l4EndpointEntity } from "../../network"
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
    ...pick(sharedSecrets, ["rootPassword", "backupKey"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster"]),
    ...pick(optionalSharedInputs, ["resticRepo"]),
  },

  outputs: {
    postgresql: databases.postgresqlEntity,
    service: serviceEntity,
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
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
 *
 * Requires a Kubernetes cluster to place init jobs and secrets.
 */
export const postgresqlDatabase = defineUnit({
  type: "k8s.apps.postgresql.database.v1",

  args: sharedDatabaseArgs,
  secrets: sharedDatabaseSecrets,

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "postgresql"]),
    ...pick(optionalSharedInputs, ["namespace"]),
  },

  outputs: {
    postgresql: databases.postgresqlEntity,
  },

  meta: {
    title: "PostgreSQL Database",
    icon: "simple-icons:postgresql",
    secondaryIcon: "mdi:database-plus",
    category: "Databases",
  },

  source: source("postgresql/database"),
})

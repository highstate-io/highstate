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
 * The MongoDB instance deployed on Kubernetes.
 */
export const mongodb = defineUnit({
  type: "k8s.apps.mongodb.v1",

  args: {
    ...appName("mongodb"),
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
    mongodb: databases.mongodbEntity,
    service: serviceEntity,
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  meta: {
    title: "MongoDB",
    icon: "simple-icons:mongodb",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },

  source: source("mongodb/app"),
})

/**
 * The virtual MongoDB database created on the MongoDB instance.
 *
 * Requires a Kubernetes cluster to place init jobs and secrets.
 */
export const mongodbDatabase = defineUnit({
  type: "k8s.apps.mongodb.database.v1",

  args: sharedDatabaseArgs,
  secrets: sharedDatabaseSecrets,

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "mongodb"]),
    ...pick(optionalSharedInputs, ["namespace"]),
  },

  outputs: {
    mongodb: databases.mongodbEntity,
  },

  meta: {
    title: "MongoDB Database",
    icon: "simple-icons:mongodb",
    secondaryIcon: "mdi:database-plus",
    category: "Databases",
  },

  source: source("mongodb/database"),
})

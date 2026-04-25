import {
  generateKey,
  generatePassword,
  l3EndpointToString,
  l4EndpointToString,
} from "@highstate/common"
import { Chart, Namespace, PersistentVolumeClaim, Secret } from "@highstate/k8s"
import { k8s, mongodb } from "@highstate/library"
import { forUnit, makeEntityOutput, makeSecretOutput, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts, createBootstrapServiceEndpoint } from "../shared"
import { backupEnvironment } from "./scripts"

const { stateId, args, getSecret, inputs, invokedTriggers, outputs } = forUnit(k8s.apps.mongodb)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const adminPassword = getSecret("adminPassword", generatePassword)
const backupKey = getSecret("backupKey", generateKey)

const rootPasswordSecret = Secret.create(
  `${args.appName}-root-password`,
  {
    namespace,

    stringData: {
      "mongodb-root-password": adminPassword,
    },
  },
  { deletedWith: namespace },
)

const dataVolumeClaim = PersistentVolumeClaim.create(
  `${args.appName}-data`,
  { namespace },
  { deletedWith: namespace },
)

const serviceEndpoint = createBootstrapServiceEndpoint(namespace, args.appName, 27017)

const backupJobPair = inputs.resticRepo
  ? new BackupJobPair(
      args.appName,
      {
        namespace,

        resticRepo: inputs.resticRepo,
        backupKey,

        environments: [backupEnvironment],

        backupContainer: {
          image:
            "alpine/mongosh@sha256:2d7a9cb13f433ae72c13019db935e74831359a022f0a89282e5294cf578db3bc",
        },

        restoreContainer: {
          image:
            "alpine/mongosh@sha256:2d7a9cb13f433ae72c13019db935e74831359a022f0a89282e5294cf578db3bc",
        },

        environment: {
          environment: {
            MONGODB_ROOT_PASSWORD: {
              secret: rootPasswordSecret,
              key: "mongodb-root-password",
            },
            DATABASE_HOST: serviceEndpoint.apply(l3EndpointToString),
          },
        },

        allowedEndpoints: [serviceEndpoint],
      },
      { dependsOn: dataVolumeClaim, deletedWith: namespace },
    )
  : undefined

const chart = new Chart(
  args.appName,
  {
    namespace,

    chart: charts.mongodb,

    values: {
      fullnameOverride: args.appName,
      nameOverride: args.appName,

      auth: {
        rootUsername: "root",
        existingSecret: rootPasswordSecret.metadata.name,
      },

      persistence: {
        existingClaim: dataVolumeClaim.metadata.name,
      },
    },

    service: {
      external: args.external,
    },
  },
  { dependsOn: backupJobPair, deletedWith: namespace },
)

const endpoints = await toPromise(chart.service.endpoints)

export default outputs({
  connection: makeEntityOutput({
    entity: mongodb.connectionEntity,
    identity: stateId,
    meta: {
      title: args.appName,
    },
    value: {
      endpoints,
      credentials: {
        type: "password",
        username: "root",
        password: makeSecretOutput(adminPassword),
      },
    },
  }),

  statefulSet: chart.statefulSet.entity,

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },

  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
  $terminals: chart.terminals.apply(terminals => [...terminals, backupJobPair?.terminal]),
})

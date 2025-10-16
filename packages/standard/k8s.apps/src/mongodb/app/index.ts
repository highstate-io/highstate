import { generatePassword, l3EndpointToL4, l4EndpointToString } from "@highstate/common"
import { Chart, Namespace, PersistentVolumeClaim, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, interpolate, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts } from "../../shared"
import { backupEnvironment } from "../scripts"

const { args, getSecret, inputs, invokedTriggers, outputs } = forUnit(k8s.apps.mongodb)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const rootPassword = getSecret("rootPassword", generatePassword)
const backupKey = getSecret("backupKey", generatePassword)

const rootPasswordSecret = Secret.create(
  `${args.appName}-root-password`,
  {
    namespace,

    stringData: {
      "mongodb-root-password": rootPassword,
    },
  },
  { deletedWith: namespace },
)

const dataVolumeClaim = PersistentVolumeClaim.create(
  `${args.appName}-data`,
  { namespace },
  { deletedWith: namespace },
)

const k8sCluster = await toPromise(inputs.k8sCluster)
const databaseHost = interpolate`${args.appName}.${namespace.metadata.name}.svc.cluster.local`

const databaseEndpoint = databaseHost.apply(host => ({
  ...l3EndpointToL4(host, 27017),
  metadata: {
    "k8s.service": {
      clusterId: k8sCluster.id,
      clusterName: k8sCluster.name,
      name: args.appName,
      namespace: args.appName,
      selector: { "app.kubernetes.io/name": args.appName },
      targetPort: 27017,
    },
  } satisfies k8s.EndpointServiceMetadata,
}))

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
            DATABASE_HOST: interpolate`${args.appName}.${namespace.metadata.name}.svc`,
          },
        },

        allowedEndpoints: [databaseEndpoint],
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

      volumePermissions: {
        enabled: true,
      },

      primary: {
        persistence: {
          existingClaim: dataVolumeClaim.metadata.name,
        },

        auth: {
          existingSecret: rootPasswordSecret.metadata.name,
        },
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
  mongodb: {
    endpoints,
    username: "root",
    password: rootPassword,
  },
  service: chart.service.entity,
  endpoints,

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },

  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
  $terminals: chart.terminals.apply(terminals =>
    [...terminals, backupJobPair?.terminal].filter(Boolean),
  ),
    [...terminals, backupJobPair?.terminal].filter(Boolean),
  ),
})

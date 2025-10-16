import { generatePassword, l3EndpointToL4, l4EndpointToString } from "@highstate/common"
import { Chart, Namespace, PersistentVolumeClaim, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, interpolate, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts } from "../../shared"
import { backupEnvironment, baseEnvironment } from "../scripts"

const { args, getSecret, inputs, invokedTriggers, outputs } = forUnit(k8s.apps.postgresql)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const rootPassword = getSecret("rootPassword", generatePassword)
const backupKey = getSecret("backupKey", generatePassword)

const rootPasswordSecret = Secret.create(
  `${args.appName}-root-password`,
  {
    namespace,

    stringData: {
      "postgres-password": rootPassword,
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
  ...l3EndpointToL4(host, 5432),
  metadata: {
    "k8s.service": {
      clusterId: k8sCluster.id,
      clusterName: k8sCluster.name,
      name: args.appName,
      namespace: args.appName,
      selector: { "app.kubernetes.io/name": args.appName },
      targetPort: 5432,
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

        environments: [baseEnvironment, backupEnvironment],

        environment: {
          environment: {
            PGPASSWORD: {
              secret: rootPasswordSecret,
              key: "postgres-password",
            },
            DATABASE_HOST: databaseHost,
            DATABASE_PORT: "5432",
          },
        },

        restoreContainer: {
          volume: dataVolumeClaim,

          volumeMount: {
            volume: dataVolumeClaim,
            mountPath: "/data",
            subPath: "data",
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

    chart: charts.postgresql,

    values: {
      fullnameOverride: args.appName,

      volumePermissions: {
        enabled: true,
      },

      primary: {
        persistence: {
          existingClaim: dataVolumeClaim.metadata.name,
        },

        pgHbaConfiguration: [
          "host  all         all 0.0.0.0/0 scram-sha-256",
          "host  replication all 0.0.0.0/0 scram-sha-256",
        ].join("\n"),
      },

      auth: {
        existingSecret: rootPasswordSecret.metadata.name,
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
  postgresql: {
    endpoints,
    username: "postgres",
    password: rootPassword,
  },
  service: chart.service.entity,
  endpoints,

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },

  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
  $terminals: chart.terminals.apply(terminals => [...terminals, backupJobPair?.terminal].filter(Boolean)),
})

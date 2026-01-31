import { generatePassword, l3EndpointToString, l4EndpointToString } from "@highstate/common"
import { Chart, Namespace, PersistentVolumeClaim, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts, createBootstrapServiceEndpoint } from "../../shared"
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

const serviceEndpoint = createBootstrapServiceEndpoint(namespace, args.appName, 5432)

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
            DATABASE_HOST: serviceEndpoint.apply(l3EndpointToString),
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

        allowedEndpoints: [serviceEndpoint],
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
      nameOverride: args.appName,

      auth: {
        existingSecret: rootPasswordSecret.metadata.name,
      },

      config: {
        pgHbaConfig: [
          "host  all         all 0.0.0.0/0 scram-sha-256",
          "host  replication all 0.0.0.0/0 scram-sha-256",
        ].join("\n"),
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
  postgresql: {
    endpoints,
    username: "postgres",
    password: rootPassword,
  },
  service: chart.service.entity,

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },

  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
  $terminals: chart.terminals.apply(terminals => [...terminals, backupJobPair?.terminal]),
})

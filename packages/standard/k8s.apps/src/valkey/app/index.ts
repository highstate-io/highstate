import { generateKey, l3EndpointToString, l4EndpointToString } from "@highstate/common"
import { Chart, Namespace, PersistentVolumeClaim } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts, createBootstrapServiceEndpoint } from "../../shared"
import { backupEnvironment } from "../scripts"

const { args, getSecret, inputs, invokedTriggers, outputs } = forUnit(k8s.apps.valkey)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const backupKey = getSecret("backupKey", generateKey)

const dataVolumeClaim = PersistentVolumeClaim.create(
  `${args.appName}-data`,
  { namespace },
  { deletedWith: namespace },
)

const serviceEndpoint = createBootstrapServiceEndpoint(namespace, args.appName, 6379)

const backupJobPair = inputs.resticRepo
  ? new BackupJobPair(
      args.appName,
      {
        namespace,

        resticRepo: inputs.resticRepo,
        backupKey,

        environments: [backupEnvironment],

        environment: {
          environment: {
            DATABASE_HOST: serviceEndpoint.apply(l3EndpointToString),
            DATABASE_PORT: "6379",
          },
        },

        restoreContainer: {
          volume: dataVolumeClaim,

          volumeMount: {
            volume: dataVolumeClaim,
            mountPath: "/data",
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

    chart: charts.valkey,

    values: {
      fullnameOverride: args.appName,
      nameOverride: args.appName,

      architecture: "standalone",

      auth: {
        enabled: false,
      },

      persistence: {
        existingClaim: dataVolumeClaim.metadata.name,
      },

      networkPolicy: {
        enabled: false,
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
  redis: {
    endpoints,
    database: 0,
  },
  service: chart.service.entity,

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },

  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
  $terminals: chart.terminals.apply(terminals => [...terminals, backupJobPair?.terminal]),
})

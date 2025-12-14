import { generateKey, l3EndpointToL4, l4EndpointToString } from "@highstate/common"
import { Chart, Namespace, PersistentVolumeClaim } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, interpolate, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts } from "../../shared"
import { backupEnvironment } from "../scripts"

const { args, getSecret, inputs, invokedTriggers, outputs } = forUnit(k8s.apps.valkey)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const backupKey = getSecret("backupKey", generateKey)

const dataVolumeClaim = PersistentVolumeClaim.create(
  `${args.appName}-data`,
  { namespace },
  { deletedWith: namespace },
)

const k8sCluster = await toPromise(inputs.k8sCluster)
const serviceHost = interpolate`${args.appName}.${namespace.metadata.name}.svc.cluster.local`

const serviceEndpoint = serviceHost.apply(host => ({
  ...l3EndpointToL4(host, 6379),
  metadata: {
    "k8s.service": {
      clusterId: k8sCluster.id,
      clusterName: k8sCluster.name,
      name: args.appName,
      namespace: args.appName,
      selector: {
        "app.kubernetes.io/name": args.appName,
        "app.kubernetes.io/instance": args.appName,
      },
      targetPort: 6379,
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

        environment: {
          environment: {
            DATABASE_HOST: serviceHost,
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
  endpoints,

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },

  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
  $terminals: chart.terminals.apply(terminals => [...terminals, backupJobPair?.terminal]),
})

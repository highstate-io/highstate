import {
  generateKey,
  generatePassword,
  l3EndpointToL4,
  l4EndpointToString,
} from "@highstate/common"
import { Chart, Namespace, PersistentVolumeClaim, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, interpolate, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts } from "../../shared"

const { args, getSecret, inputs, invokedTriggers, outputs } = forUnit(k8s.apps.minio)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const secretKey = getSecret("secretKey", generatePassword)
const backupKey = getSecret("backupKey", generateKey)

const credentialsSecret = Secret.create(
  `${args.appName}-credentials`,
  {
    namespace,

    stringData: {
      "root-user": args.accessKey,
      "root-password": secretKey,
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
const apiHost = interpolate`${args.appName}.${namespace.metadata.name}.svc.cluster.local`

const apiEndpoint = apiHost.apply(host => ({
  ...l3EndpointToL4(host, 9000),
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
      targetPort: 9000,
    },
  } satisfies k8s.EndpointServiceMetadata,
}))

const defaultBuckets =
  args.buckets.length === 0
    ? ""
    : args.buckets
        .map(bucket => {
          if (bucket.policy && bucket.policy !== "none") {
            return `${bucket.name}:${bucket.policy}`
          }

          return bucket.name
        })
        .join(",")

const backupJobPair = inputs.resticRepo
  ? new BackupJobPair(
      args.appName,
      {
        namespace,

        resticRepo: inputs.resticRepo,
        backupKey,

        restoreContainer: {
          volume: dataVolumeClaim,

          volumeMount: {
            volume: dataVolumeClaim,
            mountPath: "/data",
          },
        },

        backupContainer: {
          volume: dataVolumeClaim,

          volumeMount: {
            volume: dataVolumeClaim,
            mountPath: "/data",
          },
        },

        allowedEndpoints: [apiEndpoint],
      },
      { dependsOn: dataVolumeClaim, deletedWith: namespace },
    )
  : undefined

const chartDependsOn = backupJobPair ? [credentialsSecret, backupJobPair] : [credentialsSecret]

const chart = new Chart(
  args.appName,
  {
    namespace,

    chart: charts.minio,

    values: {
      fullnameOverride: args.appName,
      nameOverride: args.appName,

      auth: {
        rootUser: args.accessKey,
        existingSecret: credentialsSecret.metadata.name,
        existingSecretUserKey: "root-user",
        existingSecretPasswordKey: "root-password",
      },

      config: {
        region: args.region,
      },

      persistence: {
        existingClaim: dataVolumeClaim.metadata.name,
      },

      defaultBuckets,
    },

    service: {
      external: args.external,
    },
  },
  { dependsOn: chartDependsOn, deletedWith: namespace },
)

const endpoints = await toPromise(chart.service.endpoints)

export default outputs({
  s3: {
    endpoints,
    region: args.region,
    accessKey: args.accessKey,
    secretKey,
    buckets: args.buckets,
  },
  service: chart.service.entity,
  endpoints,

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },

  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
  $terminals: chart.terminals.apply(terminals => [...terminals, backupJobPair?.terminal]),
})

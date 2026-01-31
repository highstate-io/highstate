import { generateKey, generatePassword, l4EndpointToString } from "@highstate/common"
import { Chart, Namespace, PersistentVolumeClaim, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts, createBootstrapServiceEndpoint } from "../../shared"

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

const serviceEndpoint = createBootstrapServiceEndpoint(namespace, args.appName, 9000)

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

        allowedEndpoints: [serviceEndpoint],
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

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },

  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
  $terminals: chart.terminals.apply(terminals => [...terminals, backupJobPair?.terminal]),
})

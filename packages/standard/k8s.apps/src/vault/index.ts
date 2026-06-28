import { generateKey } from "@highstate/common"
import { Chart, Namespace, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, output, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts } from "../shared"

const { args, getSecret, inputs, invokedTriggers, outputs } = forUnit(k8s.apps.vault)

const { k8sCluster, s3Bucket, resticRepo } = await toPromise(inputs)

const namespace = Namespace.create(args.namespace ?? args.appName, { cluster: k8sCluster })

const backupKey = getSecret("backupKey", generateKey)

// prepare secrets and values for chart
// biome-ignore lint/suspicious/noExplicitAny: dynamic chart values
let chartValues: any = {
  server: {
    ha: {
      enabled: false,
    },
    readinessProbe: {
      enabled: false, // otherwise service will freeze unless vault is unsealed
    },
  },
}

let s3Secret: Secret | undefined

if (args.backend === "s3") {
  if (!s3Bucket) {
    throw new Error("s3Bucket input is required when backend is 's3'")
  }

  s3Secret = Secret.create(`${args.appName}-s3-credentials`, {
    namespace,
    stringData: {
      AWS_ACCESS_KEY_ID: s3Bucket.credentials.accessKey.value,
      AWS_SECRET_ACCESS_KEY: s3Bucket.credentials.secretKey.value,
    },
  })

  chartValues = {
    ...chartValues,
    server: {
      ...chartValues.server,
      dataStorage: {
        storageType: "s3",
        s3: {
          bucket: s3Bucket.name,
          region: s3Bucket.region,
          endpoint: s3Bucket.endpoints[0]?.address,
          existingSecret: s3Secret.metadata.name,
          existingSecretAccessKey: "AWS_ACCESS_KEY_ID",
          existingSecretSecretKey: "AWS_SECRET_ACCESS_KEY",
        },
      },
    },
  }
}

const chart = new Chart(
  args.appName,
  {
    namespace,
    chart: charts.vault,
    values: {
      fullnameOverride: args.appName,
      nameOverride: args.appName,
      ...chartValues,
    },
    service: { external: args.external },
    routes: args.fqdn
      ? {
          main: {
            type: "http",
            fqdn: args.fqdn,
            accessPoint: inputs.accessPoint,
            servicePort: 8200,
          },
        }
      : {},
  },
  { dependsOn: s3Secret, deletedWith: namespace },
)

const backupJobPairs =
  resticRepo && args.backend === "file"
    ? chart.statefulSet.apply(statefulSet => {
        return statefulSet.persistentVolumeClaims.apply(persistentVolumeClaims => {
          return persistentVolumeClaims.map((volume, index) => {
            return new BackupJobPair(
              `${args.appName}-${index}`,
              {
                namespace,

                resticRepo,
                backupKey,

                volume,
              },
              { dependsOn: volume, deletedWith: namespace },
            )
          })
        })
      })
    : output([] as BackupJobPair[])

export default outputs({
  statefulSet: chart.statefulSet.entity,

  $statusFields: {
    endpoint: args.fqdn ? `https://${args.fqdn}` : undefined,
  },

  $triggers: backupJobPairs.apply(backupJobPairs => {
    return backupJobPairs.map(backupJobPair => backupJobPair.handleTrigger(invokedTriggers))
  }),

  $terminals: output({ backupJobPairs, terminals: chart.terminals }).apply(
    ({ backupJobPairs, terminals }) => {
      return [...terminals, ...backupJobPairs.flatMap(backupJobPair => backupJobPair.terminals)]
    },
  ),
})

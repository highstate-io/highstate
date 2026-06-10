import { generateKey } from "@highstate/common"
import { Chart, Namespace, PersistentVolumeClaim, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, type Resource, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts } from "../shared"

const { args, getSecret, inputs, outputs } = forUnit(k8s.apps.vault)

const { k8sCluster, s3Bucket, resticRepo } = await toPromise(inputs)

const namespace = Namespace.create(args.namespace ?? args.appName, { cluster: k8sCluster })

const backupKey = getSecret("backupKey", generateKey)

// prepare PVC for `file` backend
const dataVolumeClaim =
  args.backend === "file"
    ? PersistentVolumeClaim.create(
        `${args.appName}-data`,
        { namespace },
        { deletedWith: namespace },
      )
    : undefined

// if restic repo provided and file backend, configure backup job pair
const backupJobPair =
  resticRepo && args.backend === "file"
    ? new BackupJobPair(
        args.appName,
        {
          namespace,

          resticRepo,
          backupKey,

          volume: dataVolumeClaim!,
        },
        { dependsOn: dataVolumeClaim, deletedWith: namespace },
      )
    : undefined

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

if (args.backend === "file") {
  chartValues = {
    ...chartValues,
    server: {
      ...chartValues.server,
      dataStorage: {
        storageClass: "",
        existingClaim: dataVolumeClaim ? dataVolumeClaim.metadata.name : undefined,
      },
    },
  }
} else {
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

const chartDependsOn: Resource[] = []
if (backupJobPair) chartDependsOn.push(backupJobPair)
if (s3Secret) chartDependsOn.push(s3Secret)

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
  { dependsOn: chartDependsOn, deletedWith: namespace },
)

export default outputs({
  statefulSet: chart.statefulSet.entity,

  $statusFields: {
    endpoint: args.fqdn ? `https://${args.fqdn}` : undefined,
  },

  $terminals: chart.terminals.apply(terminals => [...terminals, backupJobPair?.terminal]),
})

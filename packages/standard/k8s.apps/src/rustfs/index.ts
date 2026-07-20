import type { types } from "@pulumi/kubernetes"
import {
  generateKey,
  generatePassword,
  l4EndpointToL7,
  l4EndpointToString,
  parseEndpoint,
} from "@highstate/common"
import { Chart, ClusterAccessScope, Namespace, PersistentVolumeClaim, Secret } from "@highstate/k8s"
import { k8s, rustfs } from "@highstate/library"
import { forUnit, makeEntityOutput, makeSecretOutput, output, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts } from "../shared"

const { stateId, args, getSecret, inputs, invokedTriggers, outputs } = forUnit(k8s.apps.rustfs)

if ((args.consoleFqdn || args.fqdn) && !inputs.accessPoint) {
  throw new Error("Access point must be provided when fqdn or consoleFqdn is set")
}

const namespace = Namespace.create(args.namespace ?? args.appName, { cluster: inputs.k8sCluster })
const adminPassword = getSecret("adminPassword", generatePassword)
const backupKey = getSecret("backupKey", generateKey)

const credentialsSecret = Secret.create(
  `${args.appName}-credentials`,
  {
    namespace,

    stringData: {
      RUSTFS_ACCESS_KEY: "rustfs",
      RUSTFS_SECRET_KEY: adminPassword,
    },
  },
  { deletedWith: namespace },
)

const S3_PORT = 9000
const CONSOLE_PORT = 9001

const routes = {
  ...(args.fqdn
    ? {
        main: {
          type: "http" as const,
          fqdn: args.fqdn,
          accessPoint: inputs.accessPoint!,
          servicePort: S3_PORT,
        },
      }
    : {}),

  ...(args.consoleFqdn
    ? {
        console: {
          type: "http" as const,
          fqdn: args.consoleFqdn,
          accessPoint: inputs.accessPoint!,
          servicePort: CONSOLE_PORT,
        },
      }
    : {}),
}

const standalone = args.mode === "standalone"
const claimNames = standalone
  ? [`${args.appName}-data`, `${args.appName}-logs`]
  : Array.from({ length: args.replicas }, (_, ordinal) => [
      `logs-${args.appName}-${ordinal}`,
      ...(args.drivesPerNode === 1
        ? [`data-${args.appName}-${ordinal}`]
        : Array.from(
            { length: args.drivesPerNode },
            (_, drive) => `data-rustfs-${drive}-${args.appName}-${ordinal}`,
          )),
    ]).flat()

const volumeClaims = claimNames.map(claimName =>
  PersistentVolumeClaim.create(
    claimName,
    {
      name: claimName,
      namespace,
      storageClassName: args.storageClass,
      size:
        claimName.startsWith("logs") || claimName.endsWith("-logs")
          ? args.logStorageSize
          : args.dataStorageSize,
    },
    { deletedWith: namespace },
  ),
)

const backupJobPairs = inputs.resticRepo
  ? volumeClaims.map(
      (volumeClaim, index) =>
        new BackupJobPair(
          claimNames[index]!,
          {
            namespace,
            resticRepo: inputs.resticRepo!,
            backupKey,
            scheduling: args.scheduling,
            volume: volumeClaim,
          },
          { dependsOn: volumeClaim, deletedWith: namespace },
        ),
    )
  : []

const restoreAccess = backupJobPairs.length
  ? new ClusterAccessScope(
      `${args.appName}-restore`,
      {
        namespace,
        rules: backupJobPairs.map(backupJobPair => backupJobPair.restoreWaitRule),
      },
      { deletedWith: namespace },
    )
  : undefined

const chart = new Chart(
  args.appName,
  {
    namespace,
    args,

    chart: charts.rustfs,
    serviceName: `${args.appName}-svc`,

    values: {
      ...args.scheduling,

      fullnameOverride: args.appName,
      nameOverride: args.appName,

      replicaCount: standalone ? 1 : args.replicas,
      drivesPerNode: args.drivesPerNode,

      mode: {
        standalone: {
          enabled: standalone,
          existingClaim: {
            dataClaim: standalone ? `${args.appName}-data` : "",
            logsClaim: standalone ? `${args.appName}-logs` : "",
          },
        },
        distributed: {
          enabled: !standalone,
        },
      },

      secret: {
        existingSecret: credentialsSecret.metadata.name,
      },

      config: {
        rustfs: {
          region: args.region,
        },
      },

      extraEnv: args.unsafeBypassDiskCheck
        ? [
            {
              name: "RUSTFS_UNSAFE_BYPASS_DISK_CHECK",
              value: "true",
            },
          ]
        : [],

      storageclass: {
        name: args.storageClass,
        dataStorageSize: args.dataStorageSize,
        logStorageSize: args.logStorageSize,
      },

      ...(args.allowLessNodes && !standalone
        ? {
            affinity: {
              nodeAffinity: args.scheduling.affinity?.nodeAffinity ?? {},
              podAntiAffinity: {
                enabled: false,
              },
            },

            topologySpreadConstraints: {
              enabled: true,
              constraints: [
                {
                  maxSkew: 1,
                  topologyKey: "kubernetes.io/hostname",
                  whenUnsatisfiable: "ScheduleAnyway",
                  labelSelector: {
                    matchLabels: {
                      "app.kubernetes.io/name": args.appName,
                    },
                  },
                },
              ],
            },
          }
        : {
            topologySpreadConstraints: {
              enabled: false,
            },
          }),

      ingress: {
        enabled: false,
      },
    },

    routes,
  },
  {
    dependsOn: [credentialsSecret, ...backupJobPairs],
    deletedWith: namespace,
    transforms: [
      transformArgs => {
        if (
          !restoreAccess ||
          (transformArgs.type !== "kubernetes:apps/v1:Deployment" &&
            transformArgs.type !== "kubernetes:apps/v1:StatefulSet")
        ) {
          return undefined
        }

        return {
          props: {
            ...transformArgs.props,
            spec: output(transformArgs.props.spec).apply(spec => {
              const initContainers = spec.template.spec?.initContainers ?? []
              const initContainerNames = new Set(
                initContainers.map((container: types.input.core.v1.Container) => container.name),
              )
              const restoreWaitContainers = backupJobPairs
                .map((backupJobPair, index) => ({
                  ...backupJobPair.restoreWaitContainer,
                  name: `wait-for-restore-${index}`,
                }))
                .filter(container => !initContainerNames.has(container.name))

              return {
                ...spec,
                template: {
                  ...spec.template,
                  spec: {
                    ...spec.template.spec,
                    serviceAccountName: restoreAccess.serviceAccountName,
                    initContainers: [...restoreWaitContainers, ...initContainers],
                  },
                },
              }
            }),
          },
          opts: transformArgs.opts,
        }
      },
    ],
  },
)

const endpoints = await toPromise(chart.service.endpoints)
const s3Endpoints = endpoints
  .filter(endpoint => endpoint.port === S3_PORT)
  .map(endpoint => l4EndpointToL7(endpoint, "http"))

const workload = standalone ? chart.deployment : chart.statefulSet

export default outputs({
  connection: makeEntityOutput({
    entity: rustfs.connectionEntity,
    identity: stateId,
    meta: {
      title: args.appName,
    },
    value: {
      endpoints: args.fqdn
        ? [parseEndpoint(`https://${args.fqdn}`, 7), ...s3Endpoints]
        : s3Endpoints,
      region: args.region,

      credentials: {
        accessKey: "rustfs",
        secretKey: makeSecretOutput(adminPassword),
      },
    },
  }),

  workload: workload.entity,

  $statusFields: {
    mode: args.mode,
    backedUpVolumes: backupJobPairs.length,
    endpoints: endpoints.map(l4EndpointToString),
  },

  $triggers: backupJobPairs.map(backupJobPair => backupJobPair.handleTrigger(invokedTriggers)),

  $terminals: output(chart.terminals).apply(terminals => [
    ...terminals,
    ...backupJobPairs.flatMap(backupJobPair => backupJobPair.terminals),
  ]),
})

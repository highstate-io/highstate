import {
  generateKey,
  generatePassword,
  l4EndpointToL7,
  l4EndpointToString,
  parseEndpoint,
} from "@highstate/common"
import { Chart, Deployment, Namespace, PersistentVolumeClaim, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, secret, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts, createBootstrapServiceEndpoint, images } from "../../shared"

const { args, getSecret, inputs, invokedTriggers, outputs } = forUnit(k8s.apps.minio)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const adminPassword = getSecret("adminPassword", generatePassword)
const backupKey = getSecret("backupKey", generateKey)

const credentialsSecret = Secret.create(
  `${args.appName}-credentials`,
  {
    namespace,

    stringData: {
      username: "admin",
      password: adminPassword,
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

if ((args.consoleFqdn || args.fqdn) && !inputs.accessPoint) {
  throw new Error("Access point must be provided when fqdn or consoleFqdn is set")
}

const DATABASE_PORT = 9000
const CONSOLE_PORT = 9090

const chart = new Chart(
  args.appName,
  {
    namespace,

    chart: charts.minio,

    values: {
      fullnameOverride: args.appName,
      nameOverride: args.appName,

      auth: {
        existingSecret: credentialsSecret.metadata.name,
        existingSecretUserKey: "username",
        existingSecretPasswordKey: "password",
      },

      config: {
        region: args.region,
      },

      persistence: {
        existingClaim: dataVolumeClaim.metadata.name,
      },

      service: {
        consolePort: CONSOLE_PORT,
      },
    },

    service: {
      external: args.external,
    },

    routes: [
      // main
      ...(args.fqdn
        ? [
            {
              type: "http" as const,
              fqdn: args.consoleFqdn,
              accessPoint: inputs.accessPoint!,
              targetPort: DATABASE_PORT,
            },
          ]
        : []),

      // console
      ...(args.consoleFqdn && !args.useConsoleFork
        ? [
            {
              type: "http" as const,
              fqdn: args.consoleFqdn,
              accessPoint: inputs.accessPoint!,
              targetPort: CONSOLE_PORT,
            },
          ]
        : []),
    ],
  },
  { dependsOn: chartDependsOn, deletedWith: namespace },
)

if (args.consoleFqdn && args.useConsoleFork) {
  Deployment.create(`${args.appName}-console`, {
    namespace,

    container: {
      image: images["minio-console"].image,

      environment: {
        CONSOLE_MINIO_SERVER: `http://${args.appName}:9000`,
        CONSOLE_MINIO_REGION: args.region,
      },

      port: {
        containerPort: CONSOLE_PORT,
        protocol: "TCP",
      },
    },

    route: {
      type: "http",
      fqdn: args.consoleFqdn,
      accessPoint: inputs.accessPoint!,
    },
  })
}

const endpoints = await toPromise(chart.service.endpoints)
const l7Endpoints = endpoints.map(endpoint => l4EndpointToL7(endpoint, "http"))

export default outputs({
  connection: {
    endpoints: args.fqdn ? [parseEndpoint(`https://${args.fqdn}`, 7), ...l7Endpoints] : l7Endpoints,
    region: args.region,

    credentials: {
      username: "admin",
      password: adminPassword,
    },
  },

  deployment: chart.deployment.entity,

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },

  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
  $terminals: chart.terminals.apply(terminals => [...terminals, backupJobPair?.terminal]),
})

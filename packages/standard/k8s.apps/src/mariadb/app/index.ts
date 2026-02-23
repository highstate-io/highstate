import type { UnitTerminal } from "@highstate/contract"
import {
  generateKey,
  generatePassword,
  l3EndpointToString,
  l4EndpointToString,
  makeEntityOutput,
} from "@highstate/common"
import {
  Chart,
  createMonitorWorker,
  Namespace,
  PersistentVolumeClaim,
  Secret,
  StatefulSet,
} from "@highstate/k8s"
import { k8s, mysql } from "@highstate/library"
import { forUnit, interpolate, type Output, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts, createBootstrapServiceEndpoint } from "../../shared"
import { backupEnvironment, baseEnvironment } from "../scripts"

const { args, getSecret, inputs, invokedTriggers, outputs } = forUnit(k8s.apps.mariadb)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const adminPassword = getSecret("adminPassword", generatePassword)
const backupKey = getSecret("backupKey", generateKey)

const rootPasswordSecret = Secret.create(
  `${args.appName}-root-password`,
  {
    namespace,

    stringData: {
      "mariadb-root-password": adminPassword,
    },
  },
  { deletedWith: namespace },
)

const dataVolumeClaim = PersistentVolumeClaim.create(
  `${args.appName}-data`,
  { namespace },
  { deletedWith: namespace },
)

const serviceEndpoint = createBootstrapServiceEndpoint(namespace, args.appName, 3306)

const backupJobPair = inputs.resticRepo
  ? new BackupJobPair(
      args.appName,
      {
        namespace,

        resticRepo: inputs.resticRepo,
        backupKey,

        distribution: "ubuntu",
        environments: [baseEnvironment, backupEnvironment],

        environment: {
          environment: {
            MARIADB_ROOT_PASSWORD: {
              secret: rootPasswordSecret,
              key: "mariadb-root-password",
            },
            DATABASE_HOST: serviceEndpoint.apply(l3EndpointToString),
            DATABASE_PORT: "3306",
          },
        },

        backupContainer: {
          volume: dataVolumeClaim,

          volumeMount: {
            volume: dataVolumeClaim,
            mountPath: "/var/lib/mysql",
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

    chart: charts.mariadb,

    values: {
      fullnameOverride: args.appName,
      nameOverride: args.appName,

      auth: {
        existingSecret: rootPasswordSecret.metadata.name,
        secretKeys: {
          rootPasswordKey: "mariadb-root-password",
        },
      },

      persistence: {
        existingClaim: dataVolumeClaim.metadata.name,
      },

      metrics: {
        enabled: false,
      },

      networkPolicy: {
        enabled: false,
      },
    },

    networkPolicy: {
      ingressRule: {
        fromAll: true,
      },
    },

    service: {
      external: args.external,
    },
  },
  { dependsOn: backupJobPair, deletedWith: namespace },
)

const endpoints = await toPromise(chart.service.endpoints)
const workloads = await toPromise(chart.workloads)

const connection = makeEntityOutput({
  entity: mysql.connectionEntity,
  identity: namespace.metadata.uid,
  meta: {
    title: args.appName,
  },
  value: {
    endpoints,
    credentials: {
      username: "root",
      password: adminPassword,
    },
  },
})

export default outputs({
  connection,
  service: chart.service.entity,

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },

  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],

  $terminals: chart.workloads.apply(workloads => {
    const terminals: Output<UnitTerminal>[] = []

    const statefulSet = workloads.find(wl => wl instanceof StatefulSet)
    if (statefulSet) {
      const terminal = statefulSet.createTerminal(
        "client",
        {
          title: "MariaDB Client",
          globalTitle: `MariaDB Client | ${args.appName}`,
          description: "Connect to the MariaDB database via Kubernetes.",
          icon: "simple-icons:mariadb",
          iconColor: "#f06292",
        },
        ["mariadb", "-u", "root", interpolate`--password=${adminPassword}`],
      )

      terminals.push(terminal, statefulSet.terminal)
    }

    if (backupJobPair) {
      terminals.push(backupJobPair.terminal)
    }

    return [...terminals]
  }),

  $workers: [await createMonitorWorker(namespace, [chart.service, ...workloads])],
})

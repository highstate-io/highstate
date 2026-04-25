import type { UnitTerminal } from "@highstate/contract"
import {
  generateKey,
  generatePassword,
  l3EndpointToString,
  l4EndpointToString,
} from "@highstate/common"
import {
  Chart,
  createMonitorWorker,
  KubeCommand,
  Namespace,
  PersistentVolumeClaim,
  Secret,
  StatefulSet,
} from "@highstate/k8s"
import { k8s, postgresql } from "@highstate/library"
import {
  forUnit,
  makeEntityOutput,
  makeSecretOutput,
  type Output,
  toPromise,
} from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { charts, createBootstrapServiceEndpoint } from "../shared"
import { backupEnvironment, baseEnvironment } from "./scripts"

const { args, getSecret, inputs, invokedTriggers, outputs } = forUnit(k8s.apps.postgresql)

const namespace = Namespace.create(args.namespace ?? args.appName, { cluster: inputs.k8sCluster })

const adminPassword = getSecret("adminPassword", generatePassword)
const backupKey = getSecret("backupKey", generateKey)

const adminPasswordSecret = Secret.create(
  `${args.appName}-admin-password`,
  {
    namespace,

    stringData: {
      "postgres-password": adminPassword,
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
              secret: adminPasswordSecret,
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
            subPath: "18/docker",
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
        existingSecret: adminPasswordSecret.metadata.name,
      },

      config: {
        pgHbaConfig: [
          "local all         all           peer",
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
const workloads = await toPromise(chart.workloads)

const systemIdCommand = KubeCommand.execInto(`${args.appName}-system-id`, {
  workload: chart.statefulSet,
  create: 'psql -tc "select to_hex(system_identifier) from pg_control_system();"',
})

const connection = makeEntityOutput({
  entity: postgresql.connectionEntity,
  identity: systemIdCommand.stdout.apply(s => s.trim()),
  meta: {
    title: args.appName,
  },
  value: {
    endpoints,
    insecure: true,
    credentials: {
      type: "password",
      username: "postgres",
      password: makeSecretOutput(adminPassword),
    },
  },
})

export default outputs({
  connection,
  statefulSet: chart.statefulSet.entity,

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
          title: "PostgreSQL Client",
          globalTitle: `PostgreSQL Client | ${args.appName}`,
          description: "Connect to the PostgreSQL database via Kubernetes.",
          icon: "simple-icons:postgresql",
          iconColor: "#336791",
        },
        ["psql", "-U", "postgres", "-d", "postgres"],
        {
          env: {
            PGPASSWORD: adminPassword,
          },
        },
      )

      terminals.push(terminal, ...statefulSet.terminals)
    }

    if (backupJobPair) {
      terminals.push(...backupJobPair.terminals)
    }

    return [...terminals]
  }),

  $workers: [await createMonitorWorker(namespace, [chart.service, ...workloads])],
})

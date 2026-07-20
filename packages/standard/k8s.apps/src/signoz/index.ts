import { Chart, Namespace } from "@highstate/k8s"
import { k8s as k8sLibrary } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { charts, createPostgresqlCredentialsSecret } from "../shared"

const { args, inputs, outputs } = forUnit(k8sLibrary.apps.signoz)

const namespace = Namespace.create(args.namespace ?? args.appName, { cluster: inputs.k8sCluster })

const postgresqlCredentials = createPostgresqlCredentialsSecret(
  `${args.appName}-postgresql-credentials`,
  namespace,
  inputs.postgresql,
  { deletedWith: namespace },
)

const chart = new Chart(
  args.appName,
  {
    namespace,
    args,

    chart: charts.signoz,
    servicePort: "http",

    values: {
      fullnameOverride: args.appName,
      nameOverride: args.appName,

      clickhouse: {
        enabled: true,
        ...args.scheduling,
        clickhouseOperator: args.scheduling,
        zookeeper: args.scheduling,
      },

      postgresql: {
        enabled: false,
        ...args.scheduling,
      },

      redpanda: {
        ...args.scheduling,
        console: args.scheduling,
        connectors: args.scheduling,
      },

      signoz: {
        ...args.scheduling,

        persistence: {
          enabled: false,
        },

        env: {
          signoz_alertmanager_signoz_external__url: `https://${args.fqdn}`,
          signoz_sqlstore_provider: "postgres",
          signoz_sqlstore_postgres_dsn: {
            valueFrom: {
              secretKeyRef: {
                name: postgresqlCredentials.metadata.name,
                key: "url",
              },
            },
          },
        },
      },

      telemetryStoreMigrator: args.scheduling,
      otelCollector: args.scheduling,
      "signoz-otel-gateway": args.scheduling,
    },

    route: {
      type: "http",
      accessPoint: inputs.accessPoint,
      fqdn: args.fqdn,
    },
  },
  { dependsOn: postgresqlCredentials, deletedWith: namespace },
)

export default outputs({
  service: chart.service.entity,

  $statusFields: {
    url: `https://${args.fqdn}`,
  },

  $terminals: chart.terminals,
})

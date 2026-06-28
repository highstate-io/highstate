import { Chart, Namespace } from "@highstate/k8s"
import { k8s as k8sLibrary } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { deepmerge } from "deepmerge-ts"
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

    chart: charts.signoz,
    servicePort: "http",

    values: deepmerge(
      {
        fullnameOverride: args.appName,
        nameOverride: args.appName,

        clickhouse: {
          enabled: true,
        },

        postgresql: {
          enabled: false,
        },

        signoz: {
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
      },
      args.values,
    ),

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

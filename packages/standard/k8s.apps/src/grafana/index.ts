import { generatePassword, l4EndpointToString } from "@highstate/common"
import { Chart, Namespace, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { charts } from "../shared"

const { args, getSecret, inputs, outputs } = forUnit(k8s.apps.grafana)

const namespace = await Namespace.createOrGet(args.appName, {
  cluster: inputs.k8sCluster,
})

const adminPassword = getSecret("adminPassword", generatePassword)

const adminSecret = Secret.create(
  `${args.appName}-admin`,
  {
    namespace,

    stringData: {
      "admin-user": "admin",
      "admin-password": adminPassword,
    },
  },
  { deletedWith: namespace },
)

const chart = new Chart(
  args.appName,
  {
    namespace,

    chart: charts.grafana,

    values: {
      fullnameOverride: args.appName,
      nameOverride: args.appName,

      admin: {
        existingSecret: adminSecret.metadata.name,
        userKey: "admin-user",
        passwordKey: "admin-password",
      },

      plugins: args.plugins,

      persistence: {

      }
    },

    route: {
      type: "http",
      accessPoint: inputs.accessPoint,
      fqdn: args.fqdn,
    },
  },
  { dependsOn: adminSecret, deletedWith: namespace },
)

export default outputs({
  service: chart.service.entity,

  $statusFields: {
    url: `http://${args.fqdn}`,
    endpoints: (await toPromise(chart.service.endpoints)).map(l4EndpointToString),
  },
})

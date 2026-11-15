import { generatePassword, l4EndpointToString } from "@highstate/common"
import { Chart, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { charts, createAppNamespace } from "../shared"

const { args, getSecret, inputs, outputs } = forUnit(k8s.apps.grafana)

const namespace = await createAppNamespace(args, inputs)

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
    args,

    chart: charts.grafana,

    values: {
      ...args.scheduling,

      fullnameOverride: args.appName,
      nameOverride: args.appName,

      admin: {
        existingSecret: adminSecret.metadata.name,
        userKey: "admin-user",
        passwordKey: "admin-password",
      },

      plugins: args.plugins,

      persistence: {},

      imageRenderer: args.scheduling,
    },

    route: {
      type: "http",
      accessPoint: inputs.accessPoint,
      fqdn: args.fqdn,
      dnsChallengeAlias: args.dnsChallengeAlias,
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

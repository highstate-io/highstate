import { trimIndentation } from "@highstate/contract"
import { Chart, getProviderAsync, Namespace, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, interpolate } from "@highstate/pulumi"
import { core, rbac } from "@pulumi/kubernetes"
import { charts } from "../shared"

const { args, inputs, outputs } = forUnit(k8s.apps.kubernetesDashboard)

const namespace = await Namespace.createOrGet(args.appName, {
  cluster: inputs.k8sCluster,
})

const provider = await getProviderAsync(inputs.k8sCluster)

const chart = new Chart(args.appName, {
  namespace,

  chart: charts["kubernetes-dashboard"],
  serviceName: "kubernetes-dashboard-kong-proxy",

  values: {
    kong: {
      proxy: {
        tls: {
          enabled: false,
        },
        http: {
          enabled: true,
        },
      },
    },
  },

  route: {
    type: "http",
    accessPoint: inputs.accessPoint,
    fqdn: args.fqdn,
  },
})

const adminUserAccount = new core.v1.ServiceAccount(
  "admin-user",
  {
    metadata: {
      name: "admin-user",
      namespace: namespace.metadata.name,
    },
  },
  { dependsOn: chart.chart, provider },
)

new rbac.v1.ClusterRoleBinding(
  "admin-user-binding",
  {
    metadata: {
      name: "admin-user-binding",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: adminUserAccount.metadata.name,
        namespace: adminUserAccount.metadata.namespace,
      },
    ],
    roleRef: {
      kind: "ClusterRole",
      name: "cluster-admin",
      apiGroup: "rbac.authorization.k8s.io",
    },
  },
  { dependsOn: chart.chart, provider },
)

const accessTokenSecret = Secret.create("admin-user-token", {
  namespace,

  metadata: {
    annotations: {
      "kubernetes.io/service-account.name": adminUserAccount.metadata.name,
    },
  },

  type: "kubernetes.io/service-account-token",
})

// NetworkPolicy.allowInsideNamespace(namespace, inputs.k8sCluster)
// NetworkPolicy.allowKubeApiServer(namespace, inputs.k8sCluster)
// NetworkPolicy.allowKubeDns(namespace, inputs.k8sCluster)

export default outputs({
  $pages: {
    index: {
      meta: {
        title: "Kubernetes Dashboard",
      },
      content: [
        {
          type: "markdown",
          content: interpolate`
            The Kubernetes Dashboard is ready at [${args.fqdn}](https://${args.fqdn})!

            To login, use the following token:

            \`\`\`
            ${accessTokenSecret.data.token.apply(token => Buffer.from(token, "base64").toString())}
            \`\`\`
          `.apply(trimIndentation),
        },
      ],
    },
  },
})

import { l3EndpointToString } from "@highstate/common"
import { Chart, Namespace } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, ResourceHook, secret, toPromise } from "@highstate/pulumi"
import { CoreV1Api, KubeConfig } from "@kubernetes/client-node"
import { chart } from "../shared"

const { args, inputs, outputs } = forUnit(k8s.cilium)

const cluster = await toPromise(inputs.k8sCluster)

const afterCreateHook = new ResourceHook("restart-all-pods", async () => {
  // restart (delete) all pods to make Cilium manage their networking
  const kubeConfig = new KubeConfig()
  kubeConfig.loadFromString(cluster.kubeconfig)

  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  const allPods = await coreApi.listPodForAllNamespaces()

  await Promise.all(
    allPods.items.map(pod =>
      coreApi.deleteNamespacedPod({
        name: pod.metadata?.name!,
        namespace: pod.metadata?.namespace!,
      }),
    ),
  )
})

new Chart(
  "cilium",
  {
    namespace: Namespace.get("kube-system", { name: "kube-system", cluster }),
    chart,

    values: {
      ipam: {
        mode: "kubernetes",
      },

      kubeProxyReplacement: "true",

      operator: {
        replicas: 1,
      },

      hubble: {
        relay: {
          enabled: args.enableHubble,
        },
        ui: {
          enabled: args.enableHubble,
        },
      },

      dnsProxy: {
        dnsRejectResponseCode: "nameError",
      },

      k8sServiceHost: l3EndpointToString(cluster.apiEndpoints[0]),
      k8sServicePort: cluster.apiEndpoints[0].port.toString(),
    },
  },
  { hooks: { afterCreate: [afterCreateHook] } },
)

export default outputs({
  k8sCluster: secret({
    ...cluster,
    cni: "cilium",
    metadata: {
      ...cluster.metadata,
      cilium: {
        allowForbiddenFqdnResolution: args.allowForbiddenFqdnResolution ?? false,
      },
    } satisfies k8s.CiliumClusterMetadata,
  }),
})

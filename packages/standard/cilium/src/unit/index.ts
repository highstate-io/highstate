import { l3EndpointToString } from "@highstate/common"
import { Chart, Namespace } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, ResourceHook, secret, setResourceHooks, toPromise } from "@highstate/pulumi"
import { CoreV1Api, KubeConfig } from "@kubernetes/client-node"
import { chart } from "../shared"

const { args, inputs, outputs } = forUnit(k8s.cilium)

const cluster = await toPromise(inputs.k8sCluster)

const afterCreateHook = new ResourceHook("restart-all-pods", async () => {
  // restart (delete) all pods to make Cilium manage their networking
  const kubeConfig = new KubeConfig()

  if (cluster.kubeconfig.content.type !== "embedded-secret") {
    throw new Error("Only embedded secrets are supported for kubeconfig content in this unit.")
  }

  kubeConfig.loadFromString(cluster.kubeconfig.content.value.value)

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

setResourceHooks()

new Chart(
  "cilium",
  {
    namespace: Namespace.get("kube-system", { name: "kube-system", cluster }),
    chart,

    values: {
      tolerations: args.agentTolerations,

      ipam: {
        mode: "kubernetes",
      },

      kubeProxyReplacement: "true",

      operator: {
        replicas: 1,
        tolerations: args.operatorTolerations,
      },

      envoy: {
        tolerations: args.envoyTolerations,
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
    networkPolicyImplRef: {
      package: "@highstate/cilium",
      data: {},
    },
    metadata: {
      ...cluster.metadata,
      "cilium.cni": {
        allowForbiddenFqdnResolution: args.allowForbiddenFqdnResolution ?? false,
      },
    } satisfies k8s.CiliumClusterMetadata,
  }),
})

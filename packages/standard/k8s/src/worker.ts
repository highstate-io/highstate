import type { UnitWorker } from "@highstate/contract"
import type { k8s } from "@highstate/library"
import type { DeepInput, Input, InputArray, Unwrap } from "@highstate/pulumi"
import type { Namespace } from "./namespace"
import { type Output, output } from "@pulumi/pulumi"
import { ClusterAccessScope } from "./rbac"
import { getClusterKubeconfigContent, images, type NamespacedResource } from "./shared"

export async function createMonitorWorker(
  namespace: Input<Namespace>,
  resources: InputArray<NamespacedResource>,
): Promise<Output<Unwrap<UnitWorker>>> {
  const scope = new ClusterAccessScope("monitor", {
    rule: {
      apiGroups: ["", "apps"],
      resources: ["deployments", "statefulsets", "services", "pods"],
      verbs: ["get", "list", "watch"],
    },

    namespace,
    resources,
  })

  return output({
    name: "monitor",
    image: images["worker.k8s-monitor"].image,

    params: {
      kubeconfig: getClusterKubeconfigContent(scope.cluster),
      resources: output(resources).apply(resources => resources.map(r => r.entity)),
    } satisfies DeepInput<k8s.MonitorWorkerParams>,
  })
}

/**
 * Creates a dashboard worker registration for a Kubernetes cluster.
 *
 * @param kubeconfig The kubeconfig content used to access the cluster.
 */
export function createK8sDashboardWorker(kubeconfig: Input<string>): Output<Unwrap<UnitWorker>> {
  const image = images["worker.k8s-dashboard"].image
  if (!image.includes("@sha256:")) {
    throw new Error(`Kubernetes dashboard worker image must include a SHA256 digest`)
  }

  return output({
    name: "dashboard",
    image,
    params: { kubeconfig },
  })
}

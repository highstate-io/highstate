import type { UnitWorker } from "@highstate/contract"
import type { k8s } from "@highstate/library"
import type { DeepInput, Input, InputArray, Unwrap } from "@highstate/pulumi"
import type { Namespace } from "./namespace"
import { toPromise } from "@highstate/pulumi"
import { type Output, output } from "@pulumi/pulumi"
import { ClusterAccessScope } from "./rbac"
import { getClusterKubeconfigContent, images, type NamespacedResource } from "./shared"

export async function createMonitorWorker(
  namespace: Input<Namespace>,
  resources: InputArray<NamespacedResource>,
): Promise<Output<Unwrap<UnitWorker>>> {
  const first = await toPromise(output(resources)[0])
  if (!first) {
    throw new Error("A monitor requires at least one namespaced resource")
  }

  const name = `${await toPromise(first.metadata.name)}-monitor`

  const scope = new ClusterAccessScope(name, {
    namespaceOnly: true,
    rules: [
      { apiGroups: [""], resources: ["services", "pods"], verbs: ["get", "list", "watch"] },
      {
        apiGroups: ["apps"],
        resources: ["deployments", "statefulsets"],
        verbs: ["get", "list", "watch"],
      },
    ],

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

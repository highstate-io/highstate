import type { UnitWorker } from "@highstate/contract"
import type { k8s } from "@highstate/library"
import type { DeepInput, Input, InputArray, Unwrap } from "@highstate/pulumi"
import type { Namespace } from "./namespace"
import { type Output, output } from "@pulumi/pulumi"
import { ClusterAccessScope } from "./rbac"
import { images, type NamespacedResource } from "./shared"

export async function createMonitorWorker(
  namespace: Input<Namespace>,
  resources: InputArray<NamespacedResource>,
): Promise<Output<Unwrap<UnitWorker>>> {
  const scope = new ClusterAccessScope("monitor", {
    rule: {
      verbs: ["get", "list", "watch"],
    },

    namespace,
    resources,
  })

  return output({
    name: "monitor",
    image: images["worker.k8s-monitor"].image,

    params: {
      kubeconfig: scope.cluster.kubeconfig,
      resources: output(resources).apply(resources => resources.map(r => r.entity)),
    } satisfies DeepInput<k8s.MonitorWorkerParams>,
  })
}

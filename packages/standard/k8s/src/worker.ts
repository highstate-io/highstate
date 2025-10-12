import type { UnitWorker } from "@highstate/contract"
import type { k8s } from "@highstate/library"
import type { DeepInput, Input, InputArray, Unwrap } from "@highstate/pulumi"
import type { Namespace } from "./namespace"
import { type Output, output } from "@pulumi/pulumi"
import { ClusterAccessScope } from "./rbac"
import { images, type ScopedResource } from "./shared"

export async function createMonitorWorker(
  namespace: Input<Namespace>,
  resources: InputArray<ScopedResource>,
): Promise<Output<Unwrap<UnitWorker>>> {
  const scope = await ClusterAccessScope.forResources("monitor", {
    namespace,
    resources,
    verbs: ["get", "list", "watch"],
    collectionAccess: true,
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

import { l3EndpointToString } from "@highstate/common"
import { Chart, createSchedulingTransform, Namespace } from "@highstate/k8s"
import { netaminity } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { charts } from "../shared"

const { args, inputs, outputs } = forUnit(netaminity.operator)
const proxyHost =
  args.proxyHost ??
  (inputs.proxyHost ? l3EndpointToString(inputs.proxyHost) : undefined) ??
  (inputs.k8sCluster.endpoints[0] ? l3EndpointToString(inputs.k8sCluster.endpoints[0]) : undefined)

const namespace = Namespace.create("netaminity-system", { cluster: inputs.k8sCluster })

new Chart(
  "netaminity",
  {
    namespace,
    args,
    chart: charts.netaminity,
    values: {
      fullnameOverride: "netaminity",
      operator: {
        replicaCount: args.replicas,
      },
      config: {
        proxyHost: proxyHost ?? "",
      },
    },
  },
  { deletedWith: namespace, transforms: [createSchedulingTransform(args.scheduling)] },
)

export default outputs({
  k8sCluster: inputs.k8sCluster,
})

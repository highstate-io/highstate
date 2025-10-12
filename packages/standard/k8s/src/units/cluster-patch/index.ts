import { l3EndpointToString, l4EndpointToString, updateEndpoints } from "@highstate/common"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"

const { args, inputs, outputs } = forUnit(k8s.clusterPatch)

const endpoints = await updateEndpoints(
  inputs.k8sCluster.endpoints,
  args.endpoints,
  inputs.endpoints,
  args.endpointsPatchMode,
)

const apiEndpoints = await updateEndpoints(
  inputs.k8sCluster.apiEndpoints,
  args.apiEndpoints,
  inputs.apiEndpoints,
  args.apiEndpointsPatchMode,
)

export default outputs({
  k8sCluster: inputs.k8sCluster.apply(k8sCluster => ({
    ...k8sCluster,
    endpoints,
    apiEndpoints,
  })),

  endpoints,
  apiEndpoints,

  $statusFields: {
    endpoints: endpoints.map(l3EndpointToString),
    apiEndpoints: apiEndpoints.map(l4EndpointToString),
  },
})

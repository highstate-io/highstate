import { l3EndpointToString, l4EndpointToString, updateEndpointsWithFqdn } from "@highstate/common"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"

const { args, inputs, outputs } = forUnit(k8s.clusterDns)

const { endpoints } = await updateEndpointsWithFqdn(
  inputs.k8sCluster.endpoints,
  args.fqdn,
  args.endpointFilter,
  args.patchMode,
  inputs.dnsProviders,
)

const { endpoints: apiEndpoints } = await updateEndpointsWithFqdn(
  inputs.k8sCluster.apiEndpoints,
  args.apiFqdn,
  args.apiEndpointFilter,
  args.apiPatchMode,
  inputs.dnsProviders,
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

import { l3EndpointToString, l4EndpointToString, parseEndpoints } from "@highstate/common"
import { k8s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"

const { args, inputs, outputs } = forUnit(k8s.clusterPatch)

const cluster = await toPromise(inputs.k8sCluster)
const endpoints = await parseEndpoints(args.endpoints, inputs.endpoints, 3)
const apiEndpoints = await parseEndpoints(args.apiEndpoints, inputs.apiEndpoints, 4)

const newEndpoints = endpoints.length > 0 ? endpoints : cluster.endpoints
const newApiEndpoints = apiEndpoints.length > 0 ? apiEndpoints : cluster.apiEndpoints

export default outputs({
  k8sCluster: inputs.k8sCluster.apply(k8sCluster => ({
    ...k8sCluster,
    endpoints: newEndpoints,
    apiEndpoints: newApiEndpoints,
  })),

  $statusFields: {
    endpoints: endpoints.map(l3EndpointToString),
    apiEndpoints: apiEndpoints.map(l4EndpointToString),
  },
})

import type { k8s, network } from "@highstate/library"
import { filterEndpoints } from "@highstate/common"
import { isEndpointFromCluster } from "./service"

export function getBestEndpoint<TEndpoint extends network.L34Endpoint>(
  endpoints: TEndpoint[],
  cluster?: k8s.Cluster,
): TEndpoint | undefined {
  if (!endpoints.length) {
    return undefined
  }

  if (endpoints.length === 1) {
    return endpoints[0]
  }

  if (!cluster) {
    return filterEndpoints(endpoints)[0]
  }

  const clusterEndpoint = endpoints.find(endpoint => isEndpointFromCluster(endpoint, cluster))

  if (clusterEndpoint) {
    return clusterEndpoint
  }

  return filterEndpoints(endpoints)[0]
}

export function requireBestEndpoint<TEndpoint extends network.L34Endpoint>(
  endpoints: TEndpoint[],
  cluster: k8s.Cluster,
): TEndpoint {
  const endpoint = getBestEndpoint(endpoints, cluster)

  if (!endpoint) {
    throw new Error(`No best endpoint found for cluster "${cluster.name}" (${cluster.id})`)
  }

  return endpoint
}

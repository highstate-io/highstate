import type { k8s, network } from "@highstate/library"
import { isEndpointFromCluster } from "./service"

export function getBestEndpoint<TEndpoint extends network.L3Endpoint>(
  endpoints: TEndpoint[],
  cluster?: k8s.Cluster,
): TEndpoint | undefined {
  if (!endpoints.length) {
    return undefined
  }

  if (endpoints.length === 1) {
    return endpoints[0]
  }

  // try to find an endpoint from the same cluster and access it via internal endpoint
  if (cluster) {
    const clusterEndpoint = endpoints.find(
      endpoint =>
        isEndpointFromCluster(endpoint, cluster) && endpoint.metadata["k8s.service"].isInternal,
    )

    if (clusterEndpoint) {
      return clusterEndpoint
    }
  }

  // if there is no internal endpoint, try to find any public endpoint
  const publicEndpoint = endpoints.find(endpoint => endpoint.metadata["iana.scope"] === "global")
  if (publicEndpoint) {
    return publicEndpoint
  }

  // otherwise, return the first one
  return endpoints[0]
}

export function requireBestEndpoint<TEndpoint extends network.L3Endpoint>(
  endpoints: TEndpoint[],
  cluster: k8s.Cluster,
): TEndpoint {
  const endpoint = getBestEndpoint(endpoints, cluster)

  if (!endpoint) {
    throw new Error(`No best endpoint found for cluster "${cluster.name}" (${cluster.id})`)
  }

  return endpoint
}

import type { apiextensions } from "@pulumi/kubernetes"
import { l4EndpointToString, parseEndpoint } from "@highstate/common"
import { Namespace, Service } from "@highstate/k8s"
import { type k8s, netaminity, type network } from "@highstate/library"
import { makeEntityOutput, makeSecretOutput, type Output } from "@highstate/pulumi"
import charts from "../../assets/charts.json"

export { charts }

export const apiVersion = "netaminity.exeteres.net/v1"
export const proxyEndpointWaitFor = "jsonpath={.status.proxyEndpoint}"

type ResourceStatus = Record<string, unknown>

export type NetaminityResource = apiextensions.CustomResource & {
  status: Output<ResourceStatus | undefined>
}

export function resolveEndpoint(
  component: "proxy" | "target" | "tunnel",
  endpoint: string | undefined,
  endpoints: network.L4Endpoint[],
): { endpoint: string; port: number } {
  if (endpoint) {
    const parsedEndpoint = parseEndpoint(endpoint, 4)
    if (parsedEndpoint.protocol !== "tcp") {
      throw new Error(`Netaminity ${component} endpoint must use TCP`)
    }

    return { endpoint, port: parsedEndpoint.port }
  }

  const inputEndpoint = endpoints[0]
  if (!inputEndpoint) {
    throw new Error(`Netaminity ${component} requires an endpoint argument or endpoint input`)
  }
  if (inputEndpoint.protocol !== "tcp") {
    throw new Error(`Netaminity ${component} endpoint input must use TCP`)
  }

  return { endpoint: l4EndpointToString(inputEndpoint), port: inputEndpoint.port }
}

export async function resolveNamespace(
  name: string,
  namespaceName: string | undefined,
  namespaceEntity: k8s.Namespace | undefined,
  cluster: k8s.Cluster,
): Promise<Namespace> {
  return await Namespace.createOrGet(name, {
    name: namespaceName ?? name,
    cluster,
    existing: namespaceEntity,
  })
}

export function createResourceEntity(
  entity: typeof netaminity.targetEntity,
  resource: NetaminityResource,
  cluster: k8s.Cluster,
) {
  return makeEntityOutput({
    entity,
    identity: resource.metadata.uid,
    meta: {
      title: resource.metadata.name,
    },
    value: {
      clusterId: cluster.id,
      clusterName: cluster.name,
      apiVersion,
      kind: resource.kind,
      isNamespaced: true,
      metadata: resource.metadata,
    },
  })
}

export function createProxyEntity(
  resource: NetaminityResource,
  cluster: k8s.Cluster,
  sharedSecret: Output<string>,
  service: Service | undefined,
) {
  return makeEntityOutput({
    entity: netaminity.proxyEntity,
    identity: resource.metadata.uid,
    meta: {
      title: resource.metadata.name,
    },
    value: {
      clusterId: cluster.id,
      clusterName: cluster.name,
      apiVersion,
      kind: resource.kind,
      isNamespaced: true,
      metadata: resource.metadata,
      proxyEndpoint: resource.status.apply(status => String(status?.proxyEndpoint ?? "")),
      sharedSecret: makeSecretOutput(sharedSecret),
      service: service?.entity,
      endpoints: service?.endpoints,
    },
  })
}

export function createTunnelEntity(
  resource: NetaminityResource,
  cluster: k8s.Cluster,
  service: Service,
) {
  return makeEntityOutput({
    entity: netaminity.tunnelEntity,
    identity: resource.metadata.uid,
    meta: {
      title: resource.metadata.name,
    },
    value: {
      clusterId: cluster.id,
      clusterName: cluster.name,
      apiVersion,
      kind: resource.kind,
      isNamespaced: true,
      metadata: resource.metadata,
      service: service.entity,
      endpoints: service.endpoints,
    },
  })
}

export function wrapService(
  name: string,
  serviceName: string,
  namespace: Namespace,
  dependsOn: apiextensions.CustomResource,
): Service {
  return Service.get(
    name,
    {
      name: serviceName,
      namespace,
    },
    { dependsOn },
  )
}

import { z } from "@highstate/contract"
import { network } from "@highstate/library"
import { type Input, type InputArray, toPromise } from "@highstate/pulumi"
import { ImplementationMediator } from "../impl-ref"

export const dynamicEndpointResolverMediator = new ImplementationMediator(
  "dynamic-endpoint-resolver",
  z.object({ endpoint: network.l3EndpointEntity.schema }),
  network.l3EndpointEntity.schema,
)

export function resolveEndpoint<TEndpoint extends network.L3Endpoint>(
  endpoint: Input<TEndpoint>,
): Promise<TEndpoint>

export function resolveEndpoint<TEndpoint extends network.L3Endpoint>(
  endpoints: InputArray<TEndpoint>,
): Promise<TEndpoint>

export async function resolveEndpoint<TEndpoint extends network.L3Endpoint>(
  endpoint: Input<TEndpoint> | InputArray<TEndpoint>,
): Promise<TEndpoint> {
  const resolved = await toPromise(endpoint)
  const endpoints = Array.isArray(resolved) ? resolved : [resolved]

  if (endpoints.length === 0) {
    throw new Error("No endpoints provided")
  }

  // find first endpoint with implRef defined
  const implRefEndpoint = endpoints.find(endpoint => !!endpoint.implRef)

  if (!implRefEndpoint) {
    // or just use the first endpoint as is if no implRef provided
    return endpoints[0] as TEndpoint
  }

  // resolve the endpoint with implRef using the mediator
  return (await dynamicEndpointResolverMediator.call(implRefEndpoint.implRef!, {
    endpoint: implRefEndpoint,
  })) as TEndpoint
}

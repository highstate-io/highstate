import { getEntityId, z } from "@highstate/contract"
import { network } from "@highstate/library"
import { type Input, type InputArray, toPromise } from "@highstate/pulumi"
import { ImplementationMediator } from "../impl-ref"
import { emptyLifetimeScope, getOrCreateLifetimeScope, type LifetimeScopeHooks } from "../lifetime"

export type ResolvedEndpoint<TEndpoint extends network.L3Endpoint = network.L3Endpoint> = {
  /**
   * The resolved endpoint.
   */
  endpoint: TEndpoint

  /**
   * The hooks that must be passed to all entities consuming this endpoint directly or indirectly via some provider
   * to ensure proper setup and dispose of the endpoint during operations.
   */
  hooks: LifetimeScopeHooks
}

export const dynamicEndpointResolverMediator = new ImplementationMediator(
  "dynamic-endpoint-resolver",
  z.object({ endpoint: network.l3EndpointEntity.schema }),
  z.object({
    endpoint: network.l3EndpointEntity.schema,
    setup: z.custom<() => Promise<void>>(),
    dispose: z.custom<() => Promise<void>>(),
  }),
)

export function resolveEndpoint<TEndpoint extends network.L3Endpoint>(
  endpoint: Input<TEndpoint>,
): Promise<ResolvedEndpoint<TEndpoint>>

export function resolveEndpoint<TEndpoint extends network.L3Endpoint>(
  endpoints: InputArray<TEndpoint>,
): Promise<ResolvedEndpoint<TEndpoint>>

export async function resolveEndpoint<TEndpoint extends network.L3Endpoint>(
  endpoint: Input<TEndpoint> | InputArray<TEndpoint>,
): Promise<ResolvedEndpoint<TEndpoint>> {
  const resolved = await toPromise(endpoint)
  const endpoints = Array.isArray(resolved) ? resolved : [resolved]

  if (endpoints.length === 0) {
    throw new Error("No endpoints provided")
  }

  // find first endpoint with implRef defined
  const implRefEndpoint = endpoints.find(endpoint => !!endpoint.implRef)

  if (!implRefEndpoint) {
    // or just use the first endpoint as is if no implRef provided
    return {
      endpoint: endpoints[0] as TEndpoint,
      hooks: emptyLifetimeScope.hooks,
    }
  }

  // resolve the endpoint with implRef using the mediator
  const {
    endpoint: resolvedEndpoint,
    setup,
    dispose,
  } = await dynamicEndpointResolverMediator.call(implRefEndpoint.implRef!, {
    endpoint: implRefEndpoint,
  })

  const { hooks } = getOrCreateLifetimeScope(
    `endpoint-${getEntityId(resolvedEndpoint)}`,
    setup,
    dispose,
  )

  return {
    endpoint: resolvedEndpoint as TEndpoint,
    hooks,
  }
}

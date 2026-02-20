import { ImplementationMediator } from "../impl-ref"
import { z } from "@highstate/contract"
import { network } from "@highstate/library"
import { ResourceHook, toPromise, type Input, type InputArray } from "@highstate/pulumi"
import { stableId } from "../utils"
import { endpointToString } from "./endpoints"

export type ResolvedEndpoint<TEndpoint extends network.L3Endpoint = network.L3Endpoint> =
  TEndpoint & {
    [Symbol.asyncDispose]: () => Promise<void>
    beforeDeleteHooks: ResourceHook[]
    afterDeleteHooks: ResourceHook[]
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
      ...endpoints[0],
      [Symbol.asyncDispose]: () => Promise.resolve(),
      beforeDeleteHooks: [],
      afterDeleteHooks: [],
    } as ResolvedEndpoint<TEndpoint>
  }

  // resolve the endpoint with implRef using the mediator
  const {
    endpoint: resolvedEndpoint,
    setup,
    dispose,
  } = await dynamicEndpointResolverMediator.call(implRefEndpoint.implRef!, {
    endpoint: implRefEndpoint,
  })

  let setupCalled = false
  let disposeCalled = false

  const safeSetup = async () => {
    if (setupCalled) {
      return
    }

    setupCalled = true
    await setup()
  }

  const safeDispose = async () => {
    if (disposeCalled) {
      return
    }

    disposeCalled = true
    await dispose()
  }

  // create hooks to setup and dispose the resolved endpoint for destroy operations
  const setupEndpointHook = new ResourceHook(
    `setup-endpoint-${stableId(endpointToString(implRefEndpoint))}`,
    async () => {
      if (process.env.HIGHSTATE_PULUMI_COMMAND !== "destroy") {
        // this hook is only needed for destroy operations
        return
      }

      await safeSetup()
    },
  )

  const disposeEndpointHook = new ResourceHook(
    `dispose-endpoint-${stableId(endpointToString(implRefEndpoint))}`,
    async () => {
      if (process.env.HIGHSTATE_PULUMI_COMMAND !== "destroy") {
        // this hook is only needed for destroy operations
        return
      }

      await safeDispose()
    },
  )

  if (process.env.HIGHSTATE_PULUMI_COMMAND !== "destroy") {
    // for non-destroy operations, setup immediately and dispose on async dispose
    await safeSetup()
  }

  // for destroy operations we cannot setup the endpoint immediately
  // because it hangs event loop and makes pulumi think our program is not finished

  return {
    ...resolvedEndpoint,
    [Symbol.asyncDispose]: async () => {
      if (process.env.HIGHSTATE_PULUMI_COMMAND === "destroy") {
        // do not dispose on destroy, let the afterDelete hook handle it to ensure proper order of operations
        return
      }

      await safeDispose()
    },
    beforeDeleteHooks: [setupEndpointHook],
    afterDeleteHooks: [disposeEndpointHook],
  } as unknown as ResolvedEndpoint<TEndpoint>
}

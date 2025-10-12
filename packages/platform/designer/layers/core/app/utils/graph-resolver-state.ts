import type { Logger } from "pino"
import type {
  GraphResolverInput,
  GraphResolverOutput,
} from "#layers/core/app/workers/graph-resolver"
import type { GraphResolverMap, GraphResolverType } from "@highstate/backend/shared"
import type { EventHookOn } from "@vueuse/core"
import { createId } from "@paralleldrive/cuid2"
import GraphResolverWorker from "#layers/core/app/workers/graph-resolver?sharedworker"

export const mainResolverWorker = useHSWebWorker<GraphResolverInput, GraphResolverOutput>(
  GraphResolverWorker,
  { name: "graph-resolver" },
)

export type GraphResolverState<TInput, TOutput> = {
  inputs: ReadonlyMap<string, TInput>
  outputs: ReadonlyMap<string, TOutput>
  dependentMap: ReadonlyMap<string, string[]>
  onOutput: EventHookOn<{ nodeId: string; output: TOutput }>

  set: (key: string, value: TInput) => void
  delete: (key: string) => void

  dispatchInitialNodes: () => Promise<void>
}

export function useGraphResolverState<
  TType extends GraphResolverType,
  TInput = GraphResolverMap[TType][0],
  TOutput = GraphResolverMap[TType][1],
>(
  factoryType: TType,
  logger: Logger,
  worker: WebWorker<GraphResolverInput, GraphResolverOutput> = mainResolverWorker,

  /**
   * Whether to sync dependent map from the worker to the main thread.
   * This allows to traverse the dependency graph in the reverse direction,
   * but it is not needed in most cases.
   */
  syncDependentMap = false,
): GraphResolverState<TInput, TOutput> {
  const resolverId = createId()
  const ready = ref(false)
  const createRequestSent = ref(false)
  const initialNodesDispatchRequested = ref(false)

  const inputs = shallowReactive(new Map()) as Map<string, TInput>
  const outputs = shallowReactive(new Map()) as Map<string, TOutput>
  const dependentMap = shallowReactive(new Map<string, string[]>())

  const { on: onOutput, trigger: triggerOutput } = createEventHook()

  const safePostMessage = async (message: GraphResolverInput) => {
    await until(ready).toBe(true)
    worker.postMessage(message)
  }

  const createResolver = () => {
    if (createRequestSent.value) {
      logger.debug({ stateId: resolverId }, "create request already sent")
      return
    }

    logger.debug({ stateId: resolverId }, "creating state")
    createRequestSent.value = true

    worker.postMessage({
      type: "create-resolver",
      resolverId: resolverId,
      resolverType: factoryType,
      nodes: JSON.parse(JSON.stringify(Object.fromEntries(inputs))),
      syncDependentMap,
    })
  }

  worker.onMessage(message => {
    if (message.type === "ready") {
      // recreate the resolver if the worker was recreated
      if (initialNodesDispatchRequested.value) {
        createResolver()
      }
      return
    }

    if (message.resolverId !== resolverId) {
      return
    }

    switch (message.type) {
      case "resolver-ready": {
        logger.debug({ stateId: resolverId }, "state ready")

        ready.value = true
        createRequestSent.value = false
        break
      }
      case "dependent-set": {
        if (!message.dependents || message.dependents.length === 0) {
          dependentMap.delete(message.nodeId)
        } else {
          dependentMap.set(message.nodeId, message.dependents)
        }

        break
      }
      case "outputs": {
        for (const item of message.items) {
          outputs.set(item.nodeId, item.output as TOutput)
          triggerOutput({ nodeId: item.nodeId, output: item.output as TOutput })
        }
        break
      }
    }
  })

  const dispatchInitialNodes = async () => {
    initialNodesDispatchRequested.value = true
    createResolver()
    await until(ready).toBe(true)
  }

  worker.onError(() => {
    // reset the state if an error occurs and the worker is recreated
    ready.value = false
    createRequestSent.value = false
  })

  onScopeDispose(() => {
    logger.debug({ stateId: resolverId }, "disposing state")

    if (ready.value) {
      worker.postMessage({ type: "dispose-resolver", resolverId })
    }
  })

  const set = (key: string, value: TInput) => {
    inputs.set(key, value)

    if (!initialNodesDispatchRequested.value) {
      return
    }

    safePostMessage({
      type: "update-input",
      resolverId: resolverId,
      nodeId: key,
      node: JSON.parse(JSON.stringify(value)),
    })
  }

  const del = (key: string) => {
    inputs.delete(key)
    outputs.delete(key)
    safePostMessage({ type: "delete-input", resolverId: resolverId, nodeId: key })
  }

  return {
    inputs,
    outputs,
    dependentMap,
    onOutput,
    set,
    delete: del,
    dispatchInitialNodes,
  }
}

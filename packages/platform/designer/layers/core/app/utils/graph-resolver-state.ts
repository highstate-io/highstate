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
  const pendingUpdates = new Map<string, TInput>()
  const pendingDeletes = new Set<string>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  const inputs = shallowReactive(new Map()) as Map<string, TInput>
  const outputs = shallowReactive(new Map()) as Map<string, TOutput>
  const dependentMap = shallowReactive(new Map<string, string[]>())

  const { on: onOutput, trigger: triggerOutput } = createEventHook()

  const safePostMessage = async (message: GraphResolverInput) => {
    await until(ready).toBe(true)
    worker.postMessage(message)
  }

  const scheduleFlush = () => {
    if (flushTimer) {
      return
    }

    flushTimer = setTimeout(() => {
      flushTimer = null

      const updates = Array.from(pendingUpdates.entries())
      const deletes = Array.from(pendingDeletes.values())

      pendingUpdates.clear()
      pendingDeletes.clear()

      for (const [key, value] of updates) {
        safePostMessage({
          type: "update-input",
          resolverId: resolverId,
          nodeId: key,
          node: JSON.parse(JSON.stringify(value)),
        })
      }

      for (const key of deletes) {
        safePostMessage({ type: "delete-input", resolverId: resolverId, nodeId: key })
      }
    }, 0)
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
      case "dependent-set-batch": {
        for (const item of message.items) {
          if (!item.dependents || item.dependents.length === 0) {
            dependentMap.delete(item.nodeId)
          } else {
            dependentMap.set(item.nodeId, item.dependents)
          }
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

    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }

    if (ready.value) {
      worker.postMessage({ type: "dispose-resolver", resolverId })
    }
  })

  const set = (key: string, value: TInput) => {
    inputs.set(key, value)

    if (!initialNodesDispatchRequested.value) {
      return
    }

    pendingDeletes.delete(key)
    pendingUpdates.set(key, value)
    scheduleFlush()
  }

  const del = (key: string) => {
    inputs.delete(key)
    outputs.delete(key)

    if (!initialNodesDispatchRequested.value) {
      return
    }

    pendingUpdates.delete(key)
    pendingDeletes.add(key)
    scheduleFlush()
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

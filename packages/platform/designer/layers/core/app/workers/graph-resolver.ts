import {
  resolverFactories,
  type DependentSetHandler,
  type GraphResolver,
  type GraphResolverType,
  type ResolverOutputHandler,
} from "@highstate/backend/shared"
import { pino, type Logger } from "pino"

export type GraphResolverInput =
  | {
      type: "create-resolver"
      resolverType: GraphResolverType
      resolverId: string
      nodes: Record<string, unknown>
      syncDependentMap?: boolean
    }
  | {
      type: "update-input"
      resolverId: string
      nodeId: string
      node: unknown
    }
  | {
      type: "delete-input"
      resolverId: string
      nodeId: string
    }
  | {
      type: "dispose-resolver"
      resolverId: string
    }

export type OutputItem = {
  nodeId: string
  output: unknown
}

export type GraphResolverOutput =
  | {
      type: "outputs"
      resolverId: string
      items: OutputItem[]
    }
  | {
      type: "dependent-set"
      resolverId: string
      nodeId: string
      dependents: string[] | undefined
    }
  | {
      type: "dependent-set-batch"
      resolverId: string
      items: Array<{
        nodeId: string
        dependents: string[] | undefined
      }>
    }
  | {
      type: "ready"
    }
  | {
      type: "resolver-ready"
      resolverId: string
    }

const postMessage = (port: MessagePort, message: GraphResolverOutput) => {
  port.postMessage(message)
}

type GraphResolverState = {
  nodes: Map<string, unknown>
  resolver: GraphResolver<unknown, unknown>
  abortController: AbortController
  logger: Logger
  isProcessing: boolean
  processRequested: boolean
  pendingOutputs: Map<string, OutputItem>
  pendingDependentSets: Map<string, string[] | undefined>
  flushTimer: ReturnType<typeof setTimeout> | null
}

const resolvers = new Map<string, GraphResolverState>()

const OUTPUT_CHUNK_SIZE = 128

const flushOutputs = (port: MessagePort, resolverId: string, state: GraphResolverState) => {
  if (state.pendingOutputs.size === 0) {
    return
  }

  const items = Array.from(state.pendingOutputs.values())
  state.pendingOutputs.clear()

  for (let i = 0; i < items.length; i += OUTPUT_CHUNK_SIZE) {
    postMessage(port, {
      type: "outputs",
      resolverId,
      items: items.slice(i, i + OUTPUT_CHUNK_SIZE),
    })
  }
}

const scheduleFlush = (port: MessagePort, resolverId: string, state: GraphResolverState) => {
  if (state.flushTimer) {
    return
  }

  state.flushTimer = setTimeout(() => {
    state.flushTimer = null

    flushOutputs(port, resolverId, state)

    if (state.pendingDependentSets.size > 0) {
      const items = Array.from(state.pendingDependentSets.entries()).map(([nodeId, dependents]) => ({
        nodeId,
        dependents,
      }))

      postMessage(port, {
        type: "dependent-set-batch",
        resolverId,
        items,
      })
      state.pendingDependentSets.clear()
    }
  }, 0)
}

const requestProcess = (port: MessagePort, state: GraphResolverState) => {
  if (state.isProcessing) {
    state.processRequested = true
    return
  }

  state.isProcessing = true

  const signal = state.abortController.signal

  void state.resolver
    .process(signal)
    .catch(error => {
      state.logger.error({ error }, "failed to process resolver updates")
    })
    .finally(() => {
      state.isProcessing = false

      if (state.processRequested) {
        state.processRequested = false
        requestProcess(port, state)
      }
    })
}

const createGraphResolver = async (
  port: MessagePort,
  nodes: Map<string, unknown>,
  resolverId: string,
  resolverType: GraphResolverType,
  syncDependentMap = false,
) => {
  if (resolvers.has(resolverId)) {
    console.warn(`state with id "${resolverId}" already exists`)
    return
  }

  const logger = pino({ level: import.meta.dev ? "debug" : "info" }).child({
    resolverId,
    resolverType,
  })

  const outputHandler: ResolverOutputHandler<unknown> = (id, value) => {
    const state = resolvers.get(resolverId)
    if (!state) {
      return
    }

    state.pendingOutputs.set(id, { nodeId: id, output: value })
    scheduleFlush(port, resolverId, state)
  }

  let dependentSetHandler: DependentSetHandler | undefined
  if (syncDependentMap) {
    dependentSetHandler = (id, dependents) => {
      const state = resolvers.get(resolverId)
      if (!state) {
        return
      }

      state.pendingDependentSets.set(id, dependents && Array.from(dependents))
      scheduleFlush(port, resolverId, state)
    }
  }

  const resolver = new resolverFactories[resolverType](
    nodes,
    logger,
    outputHandler,
    dependentSetHandler,
  )

  resolvers.set(resolverId, {
    nodes,
    resolver,
    logger,
    abortController: new AbortController(),
    isProcessing: false,
    processRequested: false,
    pendingOutputs: new Map(),
    pendingDependentSets: new Map(),
    flushTimer: null,
  })

  resolver.addAllNodesToWorkset()
  await resolver.process()

  const createdState = resolvers.get(resolverId)
  if (createdState) {
    if (createdState.flushTimer) {
      clearTimeout(createdState.flushTimer)
      createdState.flushTimer = null
    }

    flushOutputs(port, resolverId, createdState)

    if (createdState.pendingDependentSets.size > 0) {
      const items = Array.from(createdState.pendingDependentSets.entries()).map(
        ([nodeId, dependents]) => ({ nodeId, dependents }),
      )

      postMessage(port, {
        type: "dependent-set-batch",
        resolverId,
        items,
      })
      createdState.pendingDependentSets.clear()
    }
  }

  postMessage(port, { type: "resolver-ready", resolverId })
}

const invalidateInput = (state: GraphResolverState, key: string, node: unknown) => {
  state.abortController.abort() // Abort any ongoing processing
  state.abortController = new AbortController()

  state.nodes.set(key, node)

  state.resolver.invalidate(key)
}

const updateInput = (port: MessagePort, resolverId: string, nodeId: string, node: unknown) => {
  const state = resolvers.get(resolverId)
  if (!state) {
    throw new Error(`Unknown state: ${resolverId}`)
  }

  invalidateInput(state, nodeId, node)
  requestProcess(port, state)
}

const deleteInput = (port: MessagePort, resolverId: string, nodeId: string) => {
  const state = resolvers.get(resolverId)
  if (!state) {
    throw new Error(`Unknown state: ${resolverId}`)
  }

  invalidateInput(state, nodeId, undefined)
  requestProcess(port, state)
}

const disposeResolver = (resolverId: string) => {
  const state = resolvers.get(resolverId)
  if (state?.flushTimer) {
    clearTimeout(state.flushTimer)
  }

  resolvers.delete(resolverId)
}

;(self as unknown as SharedWorkerGlobalScope).onconnect = (event: MessageEvent) => {
  const port = event.ports[0]

  port.onmessage = (event: MessageEvent<GraphResolverInput>) => {
    const data = event.data

    switch (data.type) {
      case "create-resolver": {
        const nodes = new Map(Object.entries(data.nodes))
        createGraphResolver(port, nodes, data.resolverId, data.resolverType, data.syncDependentMap)
        break
      }
      case "update-input": {
        updateInput(port, data.resolverId, data.nodeId, data.node)
        break
      }
      case "delete-input": {
        deleteInput(port, data.resolverId, data.nodeId)
        break
      }
      case "dispose-resolver": {
        disposeResolver(data.resolverId)
        break
      }
    }
  }

  postMessage(port, { type: "ready" })
}

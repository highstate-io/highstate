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
}

const resolvers = new Map<string, GraphResolverState>()

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
    postMessage(port, {
      type: "outputs",
      resolverId,
      items: [{ nodeId: id, output: value }],
    })
  }

  let dependentSetHandler: DependentSetHandler | undefined
  if (syncDependentMap) {
    dependentSetHandler = (id, dependents) => {
      postMessage(port, {
        type: "dependent-set",
        resolverId,
        nodeId: id,
        dependents: dependents && Array.from(dependents),
      })
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
  })

  resolver.addAllNodesToWorkset()
  await resolver.process()

  postMessage(port, { type: "resolver-ready", resolverId })
}

const invalidateInput = (state: GraphResolverState, key: string, node: unknown) => {
  state.abortController.abort() // Abort any ongoing processing
  state.abortController = new AbortController()

  state.nodes.set(key, node)
  state.resolver.invalidate(key)
  state.resolver.process(state.abortController.signal)
}

const updateInput = (resolverId: string, nodeId: string, node: unknown) => {
  const state = resolvers.get(resolverId)
  if (!state) {
    throw new Error(`Unknown state: ${resolverId}`)
  }

  state.nodes.set(nodeId, node)
  invalidateInput(state, nodeId, node)
}

const deleteInput = (resolverId: string, nodeId: string) => {
  const state = resolvers.get(resolverId)
  if (!state) {
    throw new Error(`Unknown state: ${resolverId}`)
  }

  state.nodes.delete(nodeId)
  invalidateInput(state, nodeId, undefined)
}

const disposeResolver = (resolverId: string) => {
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
        updateInput(data.resolverId, data.nodeId, data.node)
        break
      }
      case "delete-input": {
        deleteInput(data.resolverId, data.nodeId)
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

import type { Logger } from "pino"
import { unique } from "remeda"

export type ResolverOutputHandler<TOutput> = (id: string, value: TOutput) => void
export type DependentSetHandler = (id: string, dependentSet: Set<string> | undefined) => void

export abstract class GraphResolver<TNode, TOutput> {
  private readonly workset: Set<string> = new Set()
  private readonly dependencyMap: Map<string, string[]> = new Map()
  private readonly dependentMap: Map<string, Set<string>> = new Map()
  private readonly outputMap: Map<string, TOutput> = new Map()

  constructor(
    private readonly nodes: ReadonlyMap<string, TNode>,
    protected readonly logger: Logger,
    private readonly outputHandler?: ResolverOutputHandler<TOutput>,
    private readonly dependentSetHandler?: DependentSetHandler,
  ) {}

  addToWorkset(nodeId: string): void {
    this.workset.add(nodeId)
  }

  addAllNodesToWorkset(): void {
    for (const nodeId of this.nodes.keys()) {
      this.workset.add(nodeId)
    }
  }

  /**
   * The map of calculated outputs.
   */
  get outputs(): ReadonlyMap<string, TOutput> {
    return this.outputMap
  }

  /**
   * The map of dependencies for each node.
   *
   * The key is the node identifier, and the value is an array of identifiers of the nodes which depend on it.
   */
  get dependents(): ReadonlyMap<string, Set<string>> {
    return this.dependentMap
  }

  requireOutput(nodeId: string): TOutput {
    const output = this.outputMap.get(nodeId)
    if (!output) {
      throw new Error(`Output for node ${nodeId} is not available`)
    }

    return output
  }

  /**
   * Gets the list of the identifiers of the dependencies for the node.
   *
   * Used to produce the dependency graph.
   */
  protected abstract getNodeDependencies(node: TNode): string[]

  /**
   * Processes the node and returns the output.
   */
  protected abstract processNode(node: TNode, logger: Logger): TOutput | Promise<TOutput>

  /**
   * Gets the identifiers of the nodes that depend on the given node directly.
   *
   * Returns an empty array if there are no dependents.
   */
  getDependents(nodeId: string): string[] {
    const dependents = this.dependentMap.get(nodeId)
    if (!dependents) {
      return []
    }

    return Array.from(dependents)
  }

  /**
   * Invalidates the node and all nodes that depend on it.
   *
   * Also adds the node to the work set for processing.
   */
  invalidate(nodeId: string): void {
    const stack = [nodeId]

    while (stack.length > 0) {
      const nodeId = stack.pop()!
      if (!this.nodes.has(nodeId)) {
        // it is ok to invalidate deleted nodes
        continue
      }

      // remove the node from the output map
      this.outputMap.delete(nodeId)
      this.workset.add(nodeId)

      const dependents = this.dependentMap.get(nodeId)
      if (!dependents) {
        continue
      }

      for (const dependentId of dependents) {
        if (this.outputMap.has(dependentId)) {
          // add the dependent to the stack for further processing
          stack.push(dependentId)
        }
      }
    }
  }

  /**
   * Invalidates a single node without invalidating its dependents.
   *
   * Also adds the node to the work set for processing.
   *
   * Should be used with caution, as it may lead to inconsistent state if the dependents are not re-processed separately.
   */
  invalidateSingle(nodeId: string): void {
    if (!this.nodes.has(nodeId)) {
      // it is ok to invalidate deleted nodes
      return
    }

    // remove the node from the output map
    this.outputMap.delete(nodeId)
    this.workset.add(nodeId)
  }

  /**
   * Resolves all not-resolved or invalidated nodes in the graph.
   *
   * The abort signal of the previous operation must be called before calling this method again.
   */
  async process(signal?: AbortSignal): Promise<void> {
    type StackItem = {
      nodeId: string
      resolved: boolean
      dependencies: string[]
    }

    while (this.workset.size > 0) {
      const rootNodeId = this.workset.values().next().value!
      const stack: StackItem[] = [{ nodeId: rootNodeId, resolved: false, dependencies: [] }]

      while (stack.length > 0) {
        const stackItem = stack[stack.length - 1]
        const { nodeId, resolved } = stackItem

        const node = this.nodes.get(nodeId)
        if (!node) {
          this.logger.warn({ nodeId }, "node not found in the graph, skipping")
          stack.pop()
          continue
        }

        if (this.outputMap.has(nodeId)) {
          // already processed
          stack.pop()
          continue
        }

        if (!resolved) {
          stackItem.dependencies = unique(this.getNodeDependencies(node))

          let hasUnresolvedDependencies = false

          for (const depId of stackItem.dependencies) {
            if (!this.nodes.has(depId)) {
              this.logger.warn({ depId, nodeId }, "dependency not found in the graph, skipping")
              continue
            }

            if (!this.outputMap.has(depId)) {
              stack.push({ nodeId: depId, resolved: false, dependencies: [] })
              hasUnresolvedDependencies = true
            }
          }

          if (hasUnresolvedDependencies) {
            // wait for dependencies to be resolved
            stackItem.resolved = true
            continue
          }
        }

        // all dependencies are resolved, process the node
        const output = await this.processNode(node, this.logger)

        if (signal?.aborted) {
          this.logger.warn({ nodeId }, "processing aborted, skipping output")
          return
        }

        const changedDependentMaps = new Set<string>()

        // remove all dependent nodes
        const oldDependencies = this.dependencyMap.get(nodeId) ?? []
        for (const depId of oldDependencies) {
          const dependantSet = this.dependentMap.get(depId)
          if (dependantSet) {
            dependantSet.delete(nodeId)
            changedDependentMaps.add(depId)
            if (dependantSet.size === 0) {
              this.dependentMap.delete(depId)
            }
          }
        }

        // add the new dependencies
        for (const depId of stackItem.dependencies) {
          let dependantSet = this.dependentMap.get(depId)
          if (!dependantSet) {
            dependantSet = new Set()
            this.dependentMap.set(depId, dependantSet)
          }

          dependantSet.add(nodeId)
          changedDependentMaps.add(depId)
        }

        // if the dependent map has changed, notify the handler
        if (this.dependentSetHandler) {
          for (const depId of changedDependentMaps) {
            const dependents = this.dependentMap.get(depId)
            this.dependentSetHandler(depId, dependents)
          }
        }

        this.outputMap.set(nodeId, output)
        this.outputHandler?.(nodeId, output)
        this.dependencyMap.set(nodeId, stackItem.dependencies)

        stack.pop()
      }

      this.workset.delete(rootNodeId)
    }
  }
}

/**
 * Gets all identifiers of the nodes that depend on the given node directly or indirectly.
 *
 * @param dependentMap The map of dependents, received from the graph resolver.
 * @param nodeId The identifier of the node to get dependents for.
 */
export function getAllDependents(
  dependentMap: ReadonlyMap<string, Iterable<string>>,
  nodeId: string,
): string[] {
  const result = new Set<string>()
  const stack: string[] = [nodeId]

  while (stack.length > 0) {
    const dependents = dependentMap.get(stack.pop()!)
    if (!dependents) {
      continue
    }

    for (const dependentId of dependents) {
      if (!result.has(dependentId)) {
        result.add(dependentId)
        stack.push(dependentId)
      }
    }
  }

  return Array.from(result)
}

import { pino } from "pino"
import { describe, expect, test } from "vitest"
import { type DependentSetHandler, GraphResolver, getAllDependents } from "./graph-resolver"

type TestNode = {
  id: string
  value: number
  deps: string[]
  abortController?: AbortController
}

type TestOutput = {
  value: number
}

class TestResolver extends GraphResolver<TestNode, TestOutput> {
  readonly processedNodeIds: string[] = []

  protected getNodeDependencies(node: TestNode): string[] {
    return node.deps
  }

  protected processNode(node: TestNode): TestOutput {
    this.processedNodeIds.push(node.id)

    if (node.abortController) {
      node.abortController.abort()
    }

    const dependencyValue = node.deps.reduce((acc, depId) => {
      return acc + (this.outputs.get(depId)?.value ?? 0)
    }, 0)

    return {
      value: node.value + dependencyValue,
    }
  }
}

function createResolver(
  nodes: Map<string, TestNode>,
  options?: {
    outputHandler?: (id: string, value: TestOutput) => void
    dependentSetHandler?: DependentSetHandler
  },
): TestResolver {
  return new TestResolver(
    nodes,
    pino({ level: "silent" }),
    options?.outputHandler,
    options?.dependentSetHandler,
  )
}

function createNodes(
  items: Array<{ id: string; value: number; deps?: string[] }>,
): Map<string, TestNode> {
  return new Map(
    items.map(item => [
      item.id,
      {
        id: item.id,
        value: item.value,
        deps: item.deps ?? [],
      },
    ]),
  )
}

describe("GraphResolver", () => {
  test("processes all nodes in dependency-safe order", async () => {
    const nodes = createNodes([
      { id: "a", value: 1, deps: ["b", "c"] },
      { id: "b", value: 2, deps: ["c"] },
      { id: "c", value: 3 },
    ])

    const resolver = createResolver(nodes)
    resolver.addAllNodesToWorkset()

    await resolver.process()

    expect(resolver.requireOutput("c").value).toBe(3)
    expect(resolver.requireOutput("b").value).toBe(5)
    expect(resolver.requireOutput("a").value).toBe(9)

    const cIndex = resolver.processedNodeIds.indexOf("c")
    const bIndex = resolver.processedNodeIds.indexOf("b")
    const aIndex = resolver.processedNodeIds.indexOf("a")

    expect(cIndex).toBeGreaterThanOrEqual(0)
    expect(bIndex).toBeGreaterThan(cIndex)
    expect(aIndex).toBeGreaterThan(bIndex)
  })

  test("addToWorkset processes only requested node tree", async () => {
    const nodes = createNodes([
      { id: "a", value: 1, deps: ["b"] },
      { id: "b", value: 2 },
      { id: "c", value: 3 },
    ])

    const resolver = createResolver(nodes)
    resolver.addToWorkset("a")

    await resolver.process()

    expect(resolver.outputs.has("a")).toBe(true)
    expect(resolver.outputs.has("b")).toBe(true)
    expect(resolver.outputs.has("c")).toBe(false)
  })

  test("tracks direct dependents", async () => {
    const nodes = createNodes([
      { id: "a", value: 1, deps: ["b", "c"] },
      { id: "b", value: 2, deps: ["c"] },
      { id: "c", value: 3 },
    ])

    const resolver = createResolver(nodes)
    resolver.addAllNodesToWorkset()

    await resolver.process()

    expect(resolver.getDependents("c").sort()).toEqual(["a", "b"])
    expect(resolver.getDependents("b")).toEqual(["a"])
    expect(resolver.getDependents("a")).toEqual([])
  })

  test("invalidate reprocesses node and all resolved dependents", async () => {
    const nodes = createNodes([
      { id: "a", value: 1, deps: ["b"] },
      { id: "b", value: 2, deps: ["c"] },
      { id: "c", value: 3 },
    ])

    const resolver = createResolver(nodes)
    resolver.addAllNodesToWorkset()
    await resolver.process()

    nodes.get("c")!.value = 10
    resolver.invalidate("c")
    await resolver.process()

    expect(resolver.requireOutput("c").value).toBe(10)
    expect(resolver.requireOutput("b").value).toBe(12)
    expect(resolver.requireOutput("a").value).toBe(13)
  })

  test("invalidateSingle only reprocesses selected node", async () => {
    const nodes = createNodes([
      { id: "a", value: 1, deps: ["b"] },
      { id: "b", value: 2 },
    ])

    const resolver = createResolver(nodes)
    resolver.addAllNodesToWorkset()
    await resolver.process()

    nodes.get("b")!.value = 10
    resolver.invalidateSingle("b")
    await resolver.process()

    expect(resolver.requireOutput("b").value).toBe(10)
    expect(resolver.requireOutput("a").value).toBe(3)
  })

  test("canAddDependency blocks direct and transitive cycles", async () => {
    const nodes = createNodes([
      { id: "a", value: 1, deps: ["b"] },
      { id: "b", value: 2, deps: ["c"] },
      { id: "c", value: 3 },
    ])

    const resolver = createResolver(nodes)
    resolver.addAllNodesToWorkset()
    await resolver.process()

    expect(resolver.canAddDependency("a", "c")).toBe(true)
    expect(resolver.canAddDependency("b", "a")).toBe(false)
    expect(resolver.canAddDependency("c", "a")).toBe(false)
    expect(resolver.canAddDependency("a", "a")).toBe(false)
  })

  test("updates dependent map and notifies dependentSetHandler on dependency changes", async () => {
    const nodes = createNodes([
      { id: "a", value: 1, deps: ["b"] },
      { id: "b", value: 2 },
      { id: "c", value: 3 },
    ])

    const handlerCalls: Array<{ id: string; dependents: string[] | undefined }> = []

    const dependentSetHandler: DependentSetHandler = (id, dependents) => {
      handlerCalls.push({
        id,
        dependents: dependents ? Array.from(dependents).sort() : undefined,
      })
    }

    const resolver = createResolver(nodes, { dependentSetHandler })
    resolver.addAllNodesToWorkset()
    await resolver.process()

    nodes.get("a")!.deps = ["c"]
    resolver.invalidate("a")
    await resolver.process()

    expect(resolver.getDependents("b")).toEqual([])
    expect(resolver.getDependents("c")).toEqual(["a"])

    expect(handlerCalls.some(call => call.id === "b" && call.dependents === undefined)).toBe(true)
    expect(handlerCalls.some(call => call.id === "c" && call.dependents?.includes("a"))).toBe(true)
  })

  test("calls outputHandler for each processed node", async () => {
    const nodes = createNodes([
      { id: "a", value: 1, deps: ["b"] },
      { id: "b", value: 2 },
    ])

    const outputs: Array<{ id: string; value: number }> = []

    const resolver = createResolver(nodes, {
      outputHandler: (id, value) => outputs.push({ id, value: value.value }),
    })

    resolver.addAllNodesToWorkset()
    await resolver.process()

    expect(outputs).toEqual(
      expect.arrayContaining([
        { id: "b", value: 2 },
        { id: "a", value: 3 },
      ]),
    )
  })

  test("stops processing when abort signal is triggered", async () => {
    const abortController = new AbortController()

    const nodes = new Map<string, TestNode>([
      [
        "a",
        {
          id: "a",
          value: 1,
          deps: [],
          abortController,
        },
      ],
      [
        "b",
        {
          id: "b",
          value: 2,
          deps: ["a"],
        },
      ],
    ])

    const resolver = createResolver(nodes)
    resolver.addAllNodesToWorkset()

    await resolver.process(abortController.signal)

    expect(resolver.outputs.has("a")).toBe(false)
    expect(resolver.outputs.has("b")).toBe(false)
  })

  test("throws on requireOutput for unknown output", () => {
    const resolver = createResolver(createNodes([{ id: "a", value: 1 }]))

    expect(() => resolver.requireOutput("a")).toThrowError("Output for node a is not available")
  })

  test("getAllDependents collects transitive dependents", () => {
    const dependentMap = new Map<string, string[]>([
      ["a", ["b", "c"]],
      ["b", ["d"]],
      ["c", ["e"]],
    ])

    expect(getAllDependents(dependentMap, "a").sort()).toEqual(["b", "c", "d", "e"])
    expect(getAllDependents(dependentMap, "z")).toEqual([])
  })
})

import type { GraphEdge, GraphNode, VueFlowStore } from "@vue-flow/core"
import type { EdgeRouterInputMessage, EdgeRouterOutputMessage } from "../workers/edge-router"
import { readFileSync } from "node:fs"
import { useDebounceFn } from "@vueuse/core"
import { ModuleKind, transpileModule } from "typescript"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { effectScope, nextTick, onScopeDispose, ref, shallowRef } from "vue"
import { createEdgeRouterMessageQueue } from "./edge-router-message-queue"

// exercise the actual setup and Vue lifecycle without starting a browser or worker
const compiled = transpileModule(
  readFileSync(new URL("./edge-router.ts", import.meta.url), "utf8"),
  {
    compilerOptions: { module: ModuleKind.CommonJS },
  },
).outputText

function createHarness() {
  const sent: EdgeRouterInputMessage[] = []
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  let receive!: (message: EdgeRouterOutputMessage) => void
  let nodesChanged!: (changes: { type: "dimensions"; id: string }[]) => void
  let moved!: (nodes: GraphNode[], edges: GraphEdge[]) => void

  const node = {
    id: "source",
    computedPosition: { x: 0, y: 0 },
    dimensions: { width: 360, height: 77 },
  } as GraphNode

  const edge = {
    id: "edge",
    source: "source",
    target: "target",
    sourceX: 360,
    sourceY: 100,
    targetX: 600,
    targetY: 100,
    data: {},
  } as GraphEdge

  const store = {
    nodes: shallowRef([node]),
    edges: shallowRef([edge]),
    onNodesChange: (callback: typeof nodesChanged) => {
      nodesChanged = callback
    },
    onEdgesChange: vi.fn(),
    findNode: () => node,
    findEdge: () => edge,
    getConnectedEdges: () => [edge],
    updateEdgeData: vi.fn(),
  } as unknown as VueFlowStore

  const modules: Record<string, unknown> = {
    "@paralleldrive/cuid2": { createId: () => "router" },
    "#layers/core/app/workers/edge-router?sharedworker": { default: {} },
    "#layers/core/app/workers/edge-router-version": { EDGE_ROUTER_VERSION: "fixture" },
    "./edge-router-message-queue": { createEdgeRouterMessageQueue },
  }

  const setup = new Function(
    "require",
    "useHSWebWorker",
    "ref",
    "nextTick",
    "useDebounceFn",
    "onScopeDispose",
    "globalLogger",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    `const exports = {};\n${compiled}\nreturn exports.setupEdgeRouter`,
  )(
    (id: string) => {
      if (!(id in modules)) {
        throw new Error(`Unexpected router dependency: ${id}`)
      }

      return modules[id]
    },
    () => ({
      postMessage: (message: EdgeRouterInputMessage) => sent.push(structuredClone(message)),
      onMessage: (callback: typeof receive) => {
        receive = callback
      },
      onError: vi.fn(),
    }),
    ref,
    nextTick,
    useDebounceFn,
    onScopeDispose,
    { debug: vi.fn() },
    (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback)
      return frameId
    },
    (id: number) => frames.delete(id),
  )

  const scope = effectScope()

  scope.run(() =>
    setup(store, (callback: typeof moved) => {
      moved = callback
    }),
  )

  const frame = () => {
    const callbacks = [...frames.values()]
    frames.clear()

    for (const callback of callbacks) {
      callback(0)
    }
  }

  return {
    sent,
    edge,
    node,
    scope,
    frame,
    frames,
    receive: (message: EdgeRouterOutputMessage) => receive(message),
    resize: () => nodesChanged([{ type: "dimensions", id: "source" }]),
    move: () => moved([node], [edge]),
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("edge router initialization", () => {
  test("captures rendered coordinates instead of replaying pre-layout geometry", async () => {
    const harness = createHarness()

    try {
      harness.resize()
      harness.edge.sourceY = harness.edge.targetY = 317.625
      harness.node.dimensions.height = 294.625
      expect(harness.sent).toEqual([])
      await nextTick()
      harness.frame()

      expect(harness.sent).toEqual([
        expect.objectContaining({
          type: "create-router",
          shapes: [expect.objectContaining({ height: 294.625 })],
          edges: [expect.objectContaining({ sourceY: 317.625, targetY: 317.625 })],
        }),
      ])

      await vi.advanceTimersByTimeAsync(100)
      harness.receive({ type: "router-ready", routerId: "router" })
      expect(harness.sent).toHaveLength(1)
    } finally {
      harness.scope.stop()
    }
  })

  test("retains geometry changed while the initial native transaction is running", async () => {
    const harness = createHarness()

    try {
      await nextTick()
      harness.frame()
      harness.edge.sourceY = harness.edge.targetY = 317.625
      harness.node.computedPosition.y = 217.625
      harness.move()
      await vi.advanceTimersByTimeAsync(100)
      expect(harness.sent).toHaveLength(1)
      harness.receive({ type: "router-ready", routerId: "router" })

      expect(harness.sent.slice(1)).toEqual([
        expect.objectContaining({
          type: "update-shape",
          shape: expect.objectContaining({ y: 217.625 }),
        }),
        expect.objectContaining({
          type: "update-edge",
          edge: expect.objectContaining({ sourceY: 317.625 }),
        }),
        { type: "process-transaction", routerId: "router" },
      ])
    } finally {
      harness.scope.stop()
    }
  })

  test("does not create a router for a canvas closed before its layout frame", async () => {
    const harness = createHarness()
    await nextTick()
    expect(harness.frames.size).toBe(1)
    harness.scope.stop()
    harness.frame()
    expect(harness.sent).toEqual([])
  })

  test("does not schedule a layout frame for an already disposed canvas", async () => {
    const harness = createHarness()
    harness.scope.stop()
    await nextTick()
    expect(harness.frames.size).toBe(0)
    expect(harness.sent).toEqual([])
  })
})

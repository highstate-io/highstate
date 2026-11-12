import type { EdgeRouterEdge, EdgeRouterInputMessage, EdgeRouterOutputMessage } from "./edge-router"
import { readFileSync } from "node:fs"
import { ModuleKind, transpileModule } from "typescript"
import { describe, expect, test } from "vitest"

const compiled = transpileModule(
  readFileSync(new URL("./edge-router.ts", import.meta.url), "utf8"),
  {
    compilerOptions: { module: ModuleKind.CommonJS },
  },
).outputText

function createHarness() {
  const messages: EdgeRouterOutputMessage[] = []
  const transactions: number[] = []
  const timeline: (number | string)[] = []
  let ready!: () => void

  const whenReady = new Promise<void>(resolve => {
    ready = resolve
  })

  class Point {
    constructor(
      public x: number,
      public y: number,
    ) {}
  }
  class ConnEnd {
    constructor(public point: Point) {}
  }
  let connectorId = 0
  class ConnRef {
    private readonly connectorId = ++connectorId

    constructor(
      public source: ConnEnd,
      public target: ConnEnd,
    ) {}

    static createWithEndpoints(_router: Router, source: ConnEnd, target: ConnEnd) {
      return new ConnRef(source, target)
    }

    id() {
      return this.connectorId
    }

    setRoutingType() {}

    setSourceEndpoint(source: ConnEnd) {
      this.source = source
    }

    setDestEndpoint(target: ConnEnd) {
      this.target = target
    }
  }
  class Router {
    private readonly connectors: ConnRef[] = []
    private readonly routes = new Map<number, Point[]>()

    setRoutingParameter() {}

    setRoutingOption() {}

    addShape() {}

    addConnector(connector: ConnRef) {
      this.connectors.push(connector)
    }

    updateConnector() {}

    processTransaction() {
      transactions.push(this.connectors.length)
      timeline.push(this.connectors.length)

      for (const connector of this.connectors) {
        this.routes.set(connector.id(), [connector.source.point, connector.target.point])
      }
    }

    getConnectorRoute(id: number) {
      const points = this.routes.get(id)
      return points && { size: () => points.length, at: (index: number) => points[index] }
    }
  }

  const modules: Record<string, unknown> = {
    "./edge-router-version": { EDGE_ROUTER_VERSION: "fixture" },
    "./libavoid/libavoid": {
      default: async () => {},
      AvoidLib: { getInstance: () => ({}) },
      Point,
      ConnEnd,
      ConnRef,
      Router,
      ShapeRef: class {},
      Rectangle: { fromCorners: () => ({ toPolygon: () => [] }) },
    },
  }

  const worker = { onconnect: undefined as undefined | ((event: unknown) => void) }

  const port = {
    onmessage: undefined as undefined | ((event: { data: EdgeRouterInputMessage }) => void),
    postMessage(message: EdgeRouterOutputMessage) {
      messages.push(structuredClone(message))
      timeline.push(message.type)

      if (message.type === "router-ready") {
        ready()
      }
    },
  }

  new Function("require", "self", "console", `const exports = {};\n${compiled}`)(
    (id: string) => {
      if (!(id in modules)) {
        throw new Error(`Unexpected worker dependency: ${id}`)
      }

      return modules[id]
    },
    worker,
    { log() {}, debug() {} },
  )

  worker.onconnect!({ ports: [port] })

  return {
    messages,
    transactions,
    timeline,
    whenReady,
    send: (message: EdgeRouterInputMessage) => port.onmessage!({ data: message }),
    create: (edges: EdgeRouterEdge[]) =>
      port.onmessage!({
        data: {
          type: "create-router",
          routerId: "router",
          edges,
          shapes: [
            { id: "source", x: 0, y: 0, width: 100, height: 100 },
            { id: "target", x: 400, y: 0, width: 100, height: 100 },
          ],
        },
      }),
  }
}

const edge = (index: number): EdgeRouterEdge => ({
  id: `edge-${index}`,
  source: "source",
  target: "target",
  sourceX: 100,
  sourceY: index + 0.25,
  targetX: 400,
  targetY: index + 0.75,
})
const pathUpdate = (edge: EdgeRouterEdge) => ({
  edgeId: edge.id,
  points: [
    [edge.sourceX, edge.sourceY],
    [edge.targetX, edge.targetY],
  ],
})

describe("edge router worker", () => {
  test("routes all 1039 initial edges in one transaction and publishes every path before readiness", async () => {
    const harness = createHarness()
    const edges = Array.from({ length: 1039 }, (_, index) => edge(index))
    harness.create(edges)
    await harness.whenReady

    expect(harness.transactions).toEqual([1039])
    expect(harness.timeline).toEqual([1039, "edge-paths-updated", "router-ready"])

    expect(harness.messages).toEqual([
      { type: "edge-paths-updated", routerId: "router", updates: edges.map(pathUpdate) },
      { type: "router-ready", routerId: "router" },
    ])
  })

  test("routes later endpoint changes on the next explicit transaction", async () => {
    const harness = createHarness()
    harness.create([edge(0)])
    await harness.whenReady
    const updated = { ...edge(0), sourceX: 125, sourceY: 317.625, targetX: 650, targetY: 421.5 }

    harness.send({ type: "update-edge", routerId: "router", edge: updated })
    expect(harness.transactions).toEqual([1])
    expect(harness.messages).toHaveLength(2)
    harness.send({ type: "process-transaction", routerId: "router" })

    expect(harness.transactions).toEqual([1, 1])

    expect(harness.messages.slice(2)).toEqual([
      { type: "edge-paths-updated", routerId: "router", updates: [pathUpdate(updated)] },
    ])
  })
})

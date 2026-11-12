import type { EdgeRouterInputMessage } from "../workers/edge-router"
import { describe, expect, test, vi } from "vitest"
import { createEdgeRouterMessageQueue } from "./edge-router-message-queue"

const updateEdge = (id: string, y: number): EdgeRouterInputMessage => ({
  type: "update-edge",
  routerId: "router",
  edge: {
    id,
    source: "source",
    target: "target",
    sourceX: 0,
    sourceY: y,
    targetX: 500,
    targetY: y,
  },
})
const transaction: EdgeRouterInputMessage = { type: "process-transaction", routerId: "router" }

describe("edge router message queue", () => {
  test("routes the latest geometry when a transaction was queued before updates during initialization", () => {
    let endpointY = 100
    let routedY = 100
    const sent: string[] = []

    const queue = createEdgeRouterMessageQueue(message => {
      sent.push(message.type)

      if (message.type === "update-edge") {
        endpointY = message.edge.sourceY
      }

      if (message.type === "process-transaction") {
        routedY = endpointY
      }
    })

    queue.enqueue(transaction)
    queue.enqueue(updateEdge("edge", 200))
    queue.enqueue(updateEdge("edge", 317.625))
    queue.enqueue(transaction)
    queue.flush()

    expect(routedY).toBe(317.625)
    expect(sent).toEqual(["update-edge", "process-transaction"])
  })

  test("processes all shapes and connected edges before a coalesced transaction", () => {
    const send = vi.fn()
    const queue = createEdgeRouterMessageQueue(send)
    queue.enqueue(updateEdge("first", 200))
    queue.enqueue(transaction)

    queue.enqueue({
      type: "update-shape",
      routerId: "router",
      shape: { id: "source", x: 0, y: 100, width: 360, height: 294 },
    })

    queue.enqueue(updateEdge("second", 300))
    queue.flush()

    expect(send.mock.calls.map(([message]) => message.type)).toEqual([
      "update-edge",
      "update-shape",
      "update-edge",
      "process-transaction",
    ])
  })

  test("coalesces repeated updates but retains the next batch after flushing", () => {
    const send = vi.fn()
    const queue = createEdgeRouterMessageQueue(send)
    queue.enqueue(updateEdge("edge", 200))
    queue.enqueue(updateEdge("edge", 300))
    queue.enqueue(transaction)
    queue.flush()
    queue.flush()

    expect(send.mock.calls.map(([message]) => message)).toEqual([
      updateEdge("edge", 300),
      transaction,
    ])

    queue.enqueue(updateEdge("edge", 400))
    queue.enqueue(transaction)
    queue.flush()

    expect(send.mock.calls.slice(2).map(([message]) => message)).toEqual([
      updateEdge("edge", 400),
      transaction,
    ])
  })

  test("discards pending geometry and transactions after a worker error", () => {
    const send = vi.fn()
    const queue = createEdgeRouterMessageQueue(send)
    queue.enqueue(updateEdge("edge", 200))
    queue.enqueue(transaction)
    queue.clear()
    queue.flush()
    expect(send).not.toHaveBeenCalled()
  })
})

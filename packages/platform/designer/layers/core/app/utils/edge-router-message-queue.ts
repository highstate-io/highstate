import type { EdgeRouterInputMessage } from "../workers/edge-router"

const getMessageKey = (message: EdgeRouterInputMessage): string => {
  switch (message.type) {
    case "add-shape":
    case "update-shape":
      return `shape:${message.shape.id}`
    case "remove-shape":
      return `shape:${message.shapeId}`
    case "add-edge":
    case "update-edge":
      return `edge:${message.edge.id}`
    case "remove-edge":
      return `edge:${message.edgeId}`
    case "process-transaction":
      return "process-transaction"
    case "create-router":
      return `create-router:${message.routerId}`
    case "dispose-router":
      return `dispose-router:${message.routerId}`
  }
}

export function createEdgeRouterMessageQueue(send: (message: EdgeRouterInputMessage) => void) {
  const messages = new Map<string, EdgeRouterInputMessage>()

  return {
    enqueue(message: EdgeRouterInputMessage) {
      messages.set(getMessageKey(message), message)
    },
    flush() {
      const batch = Array.from(messages.values())
      messages.clear()

      for (const message of batch) {
        if (message.type !== "process-transaction") {
          send(message)
        }
      }

      // replacing a Map entry does not move it after newer geometry updates
      // route only after every coalesced mutation has reached the worker
      for (const message of batch) {
        if (message.type === "process-transaction") {
          send(message)
        }
      }
    },
    clear() {
      messages.clear()
    },
  }
}

import type { Operation } from "@highstate/backend/shared"

export function isOperationRunning(operation: Operation) {
  return (
    operation.status !== "completed" &&
    operation.status !== "failed" &&
    operation.status !== "cancelled"
  )
}

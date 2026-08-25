import { describe, expect, it } from "vitest"
import { InstanceLockLostError, InvalidPageTokenError } from "./errors"

describe("domain errors", () => {
  it("does not accept or expose the lost lock token", () => {
    const error = new InstanceLockLostError("project", ["one", "two"])
    const serialized = JSON.stringify(error)

    expect(serialized).not.toContain("token")
    expect(error.metadata).toEqual({ projectId: "project" })
  })

  it("bounds lock precondition violations", () => {
    const instanceIds = Array.from({ length: 25 }, (_, index) => `instance-${index}`)
    const error = new InstanceLockLostError("project", instanceIds)

    expect(error.instanceIds).toHaveLength(25)
    expect(error.preconditionViolations).toHaveLength(20)
  })

  it("does not expose a page token or decoded cursor", () => {
    const error = new InvalidPageTokenError("operations", "QUERY_MISMATCH")

    expect(error.metadata).toEqual({ collection: "operations" })
    expect(error.fieldViolations).toEqual([
      {
        field: "pageToken",
        reason: "QUERY_MISMATCH",
        description: "The page token is malformed or does not match this collection query",
      },
    ])
  })
})

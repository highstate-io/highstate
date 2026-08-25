import { describe, expect, it } from "vitest"
import { ProjectModelCircularInputReferenceError, ProjectModelOperationError } from "./errors"

describe("project model errors", () => {
  it("retains internal causes without putting them in descriptors", () => {
    const cause = new Error("database password is secret")
    const error = new ProjectModelOperationError("update instance", "project", cause)
    const descriptors = JSON.stringify({
      reason: error.reason,
      metadata: error.metadata,
      fieldViolations: error.fieldViolations,
      preconditionViolations: error.preconditionViolations,
    })

    expect(error.cause).toBe(cause)
    expect(descriptors).not.toContain(cause.message)
  })

  it("bounds circular reference descriptions", () => {
    const cycle = Array.from({ length: 25 }, (_, index) => `instance-${index}`)
    const error = new ProjectModelCircularInputReferenceError("project", cycle)

    expect(error.cycle).toHaveLength(25)
    expect(error.fieldViolations[0]?.description).toContain("instance-19")
    expect(error.fieldViolations[0]?.description).not.toContain("instance-20")
  })
})

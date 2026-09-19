import type { InstanceState } from "@highstate/backend/shared"
import { describe, expect, it } from "vitest"
import { applyInstanceStatePatch } from "./state-event"

describe("applyInstanceStatePatch", () => {
  it("materializes an unknown state from an operation state patch", () => {
    const state = applyInstanceStatePatch("child-state", {
      id: "child-state",
      instanceId: "component.v1:child",
      kind: "unit",
      source: "virtual",
      status: "attempted",
      lastOperationState: {
        operationId: "operation",
        stateId: "child-state",
        status: "updating",
      } as unknown as NonNullable<InstanceState["lastOperationState"]>,
    })

    expect(state).toMatchObject({
      id: "child-state",
      instanceId: "component.v1:child",
      status: "attempted",
      lastOperationState: {
        operationId: "operation",
        status: "updating",
      },
    })
  })

  it("merges a partial patch into an existing state", () => {
    const existingState = {
      id: "child-state",
      instanceId: "component.v1:child",
      kind: "unit",
      source: "virtual",
      status: "attempted",
    } as unknown as InstanceState

    expect(applyInstanceStatePatch("child-state", { status: "deployed" }, existingState)).toEqual({
      ...existingState,
      status: "deployed",
    })
  })

  it("ignores a partial patch for an unknown state", () => {
    expect(applyInstanceStatePatch("child-state", { status: "deployed" })).toBeUndefined()
  })
})

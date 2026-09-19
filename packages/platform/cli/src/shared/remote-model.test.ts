import { create, toJson } from "@bufbuild/protobuf"
import { ValueSchema } from "@bufbuild/protobuf/wkt"
import {
  InstanceArgumentPatchOperation_Operation,
  OperationPhaseSchema,
  OperationPhaseType,
} from "@highstate/api/v1"
import { describe, expect, it } from "vitest"
import {
  operationOptions,
  phasesFromPlan,
  phasesToJson,
  planDocumentSchema,
  toArgumentPatchOperation,
  toInstance,
} from "./remote-model"

describe("remote model conversion", () => {
  it("converts snake-case instance documents to protobuf messages", () => {
    const instance = toInstance({
      id: "common.server.v1:web",
      kind: "unit",
      type: "common.server.v1",
      name: "web",
      args: { port: 22 },
      inputs: {
        network: [{ instance_id: "common.network.v1:main", output: "network" }],
      },
    })

    expect(instance.arguments[0]?.key).toBe("port")
    expect(instance.inputs.network?.values[0]?.instanceId).toBe("common.network.v1:main")
  })

  it("round trips versioned operation plans", () => {
    const phase = create(OperationPhaseSchema, {
      type: OperationPhaseType.UPDATE,
      instances: [{ id: "common.server.v1:web", message: "outdated" }],
    })
    const document = planDocumentSchema.parse({
      format_version: 1,
      project_id: "project",
      type: "update",
      instance_ids: ["common.server.v1:web"],
      options: { refresh: true },
      phases: phasesToJson([phase]),
    })

    expect(toJson(OperationPhaseSchema, phasesFromPlan(document)[0]!)).toEqual(
      toJson(OperationPhaseSchema, phase),
    )
    expect(operationOptions(document.options).refresh).toBe(true)
  })

  it("converts argument patch documents to protobuf messages", () => {
    const replace = toArgumentPatchOperation({
      op: "replace",
      path: "/config/enabled",
      value: true,
    })
    const remove = toArgumentPatchOperation({ op: "remove", path: "/obsolete" })

    expect(replace.operation).toBe(InstanceArgumentPatchOperation_Operation.REPLACE)
    expect(replace.value && toJson(ValueSchema, replace.value)).toBe(true)
    expect(remove.operation).toBe(InstanceArgumentPatchOperation_Operation.REMOVE)
    expect(remove.value).toBeUndefined()
  })
})

import { create, toJson } from "@bufbuild/protobuf"
import { OperationPhaseSchema, OperationPhaseType } from "@highstate/api/v1"
import { describe, expect, it } from "vitest"
import {
  operationOptions,
  phasesFromPlan,
  phasesToJson,
  planDocumentSchema,
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
})

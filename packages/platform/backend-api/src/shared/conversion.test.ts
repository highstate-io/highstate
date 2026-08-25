import { create } from "@bufbuild/protobuf"
import { timestampDate } from "@bufbuild/protobuf/wkt"
import { ComponentKind, InstanceSchema } from "@highstate/api/v1"
import { describe, expect, it } from "vitest"
import {
  fromInstance,
  toInstance,
  toInstancePatch,
  toNullableTimestamp,
  toProjectModel,
  toTimestamp,
} from "./conversion"

describe("resource conversion", () => {
  it("converts instance dynamic values and references in both directions", () => {
    const backend = {
      id: "example.component.v1:main" as const,
      kind: "unit" as const,
      type: "example.component.v1" as const,
      name: "main" as const,
      args: { enabled: true, nested: { value: 1 } },
      inputs: {
        input: [{ instanceId: "example.source.v1:source" as const, output: "value" }],
      },
      position: { x: 10, y: 20 },
    }

    const api = toInstance(backend)

    expect(api.$typeName).toBe("io.highstate.v1.Instance")
    expect(api.kind).toBe(ComponentKind.UNIT)
    expect(fromInstance(api)).toEqual({
      ...backend,
      hubInputs: {},
      injectionInputs: [],
    })
  })

  it("rejects an unspecified component kind", () => {
    const instance = create(InstanceSchema, {
      id: "example.component.v1:main",
      type: "example.component.v1",
      name: "main",
    })

    expect(() => fromInstance(instance)).toThrow("Component kind must be specified")
  })

  it("maps whole and nested position masks to backend patches", () => {
    const instance = create(InstanceSchema, {
      id: "example.component.v1:main",
      kind: ComponentKind.UNIT,
      type: "example.component.v1",
      name: "main",
      position: { x: 10, y: 20 },
    })

    expect(toInstancePatch(instance, ["position.x"])).toEqual({ position: { x: 10 } })
    expect(toInstancePatch(instance, ["position"])).toEqual({ position: { x: 10, y: 20 } })
    expect(toInstancePatch(create(InstanceSchema, instance), ["position"])).toEqual({
      position: { x: 10, y: 20 },
    })
  })

  it("clears a whole optional position", () => {
    const instance = create(InstanceSchema, {
      id: "example.component.v1:main",
      kind: ComponentKind.UNIT,
      type: "example.component.v1",
      name: "main",
    })

    expect(toInstancePatch(instance, ["position"])).toEqual({ position: null })
  })

  it("converts valid and nullable dates", () => {
    const date = new Date("2026-08-24T12:34:56.789Z")

    expect(timestampDate(toTimestamp(date))).toEqual(date)
    expect(toNullableTimestamp(null)).toBeUndefined()
  })

  it("rejects invalid dates", () => {
    expect(() => toTimestamp(new Date(Number.NaN))).toThrow(
      "Cannot convert invalid date to timestamp",
    )
  })

  it("flattens requested virtual and ghost instances into the API project model", () => {
    const instance = {
      id: "example.component.v1:resident" as const,
      kind: "unit" as const,
      type: "example.component.v1" as const,
      name: "resident" as const,
    }
    const model = toProjectModel({
      instances: [instance],
      virtualInstances: [
        {
          ...instance,
          id: "example.component.v1:virtual",
          name: "virtual",
          parentId: instance.id,
        },
      ],
      ghostInstances: [
        {
          ...instance,
          id: "example.component.v1:ghost",
          name: "ghost",
        },
      ],
      hubs: [],
    })

    expect(model.instances.map(value => value.id)).toEqual([
      "example.component.v1:resident",
      "example.component.v1:virtual",
      "example.component.v1:ghost",
    ])
  })
})

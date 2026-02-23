import { describe, expect, test } from "vitest"
import type { VersionedName } from "@highstate/contract"
import type { ResolvedInstanceInput } from "../shared"
import { resolveUnitInputValues } from "./unit-input-values"

describe("resolveUnitInputValues", () => {
  test("returns captured values when input type matches output type", () => {
    const dependencyInstanceId = "component.v1:dep"
    const dependencyInstanceType = "component.v1" satisfies VersionedName

    const library = {
      components: {
        "component.v1": {
          outputs: {
            out: { type: "parent.v1" },
          },
        },
      },
      entities: {
        "parent.v1": {
          type: "parent.v1",
        },
      },
    }

    const resolved: ResolvedInstanceInput = {
      input: {
        instanceId: dependencyInstanceId,
        output: "out",
      } as never,
      type: "parent.v1",
    }

    const values = resolveUnitInputValues({
      library: library as never,
      inputName: "dep",
      resolvedInput: resolved,
      dependencyInstanceType,
      captured: [{ a: 1 }],
    })

    expect(values).toEqual([
      {
        value: { a: 1 },
        source: { instanceId: dependencyInstanceId, output: "out" },
      },
    ])
  })

  test("extracts inclusion field when input type differs", () => {
    const dependencyInstanceId = "component.v1:dep"
    const dependencyInstanceType = "component.v1" satisfies VersionedName

    const library = {
      components: {
        "component.v1": {
          outputs: {
            out: { type: "parent.v1" },
          },
        },
      },
      entities: {
        "parent.v1": {
          type: "parent.v1",
          inclusions: [{ type: "child.v1", field: "child" }],
        },
      },
    }

    const resolved: ResolvedInstanceInput = {
      input: {
        instanceId: dependencyInstanceId,
        output: "out",
      } as never,
      type: "child.v1",
    }

    const values = resolveUnitInputValues({
      library: library as never,
      inputName: "dep",
      resolvedInput: resolved,
      dependencyInstanceType,
      captured: [{ child: { v: 42 }, other: "x" }],
    })

    expect(values).toEqual([
      {
        value: { v: 42 },
        source: { instanceId: dependencyInstanceId, output: "out" },
      },
    ])
  })

  test("uses included entity from reconstructed parent value", () => {
    const dependencyInstanceId = "component.v1:dep"
    const dependencyInstanceType = "component.v1" satisfies VersionedName

    const library = {
      components: {
        "component.v1": {
          outputs: {
            out: { type: "parent.v1" },
          },
        },
      },
      entities: {
        "parent.v1": {
          type: "parent.v1",
          inclusions: [{ type: "child.v1", field: "child" }],
        },
        "child.v1": {
          type: "child.v1",
        },
      },
    }

    const resolved: ResolvedInstanceInput = {
      input: {
        instanceId: dependencyInstanceId,
        output: "out",
      } as never,
      type: "child.v1",
    }

    const captured = [
      {
        $meta: { type: "parent.v1", identity: "p1" },
        child: { $meta: { type: "child.v1", identity: "c1" }, v: 41 },
      },
      {
        $meta: { type: "child.v1", identity: "c1", title: "Child" },
        v: 42,
      },
    ]

    const values = resolveUnitInputValues({
      library: library as never,
      inputName: "dep",
      resolvedInput: resolved,
      dependencyInstanceType,
      captured,
    })

    expect(values).toEqual([
      {
        value: { $meta: { type: "child.v1", identity: "c1" }, v: 41 },
        source: { instanceId: dependencyInstanceId, output: "out" },
      },
    ])
  })

  test("throws when no matching inclusion exists", () => {
    const dependencyInstanceId = "component.v1:dep"
    const dependencyInstanceType = "component.v1" satisfies VersionedName

    const library = {
      components: {
        "component.v1": {
          outputs: {
            out: { type: "parent.v1" },
          },
        },
      },
      entities: {
        "parent.v1": {
          type: "parent.v1",
          inclusions: [{ type: "other.v1", field: "x" }],
        },
      },
    }

    const resolved: ResolvedInstanceInput = {
      input: {
        instanceId: dependencyInstanceId,
        output: "out",
      } as never,
      type: "child.v1",
    }

    expect(() =>
      resolveUnitInputValues({
        library: library as never,
        inputName: "dep",
        resolvedInput: resolved,
        dependencyInstanceType,
        captured: [{ child: { v: 1 } }],
      }),
    ).toThrow(/no matching inclusion found/i)
  })
})

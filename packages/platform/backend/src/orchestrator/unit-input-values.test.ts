import type { VersionedName } from "@highstate/contract"
import type { ResolvedInstanceInput } from "../shared"
import { describe, expect, test } from "vitest"
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
      captured: [{ ok: true, value: { a: 1 } }],
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
      captured: [{ ok: true, value: { child: { v: 42 }, other: "x" } }],
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
        ok: true as const,
        value: {
          $meta: { type: "parent.v1", identity: "p1" },
          child: { $meta: { type: "child.v1", identity: "c1" }, v: 41 },
        },
      },
      {
        ok: true as const,
        value: {
          $meta: { type: "child.v1", identity: "c1", title: "Child" },
          v: 42,
        },
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
        captured: [{ ok: true, value: { child: { v: 1 } } }],
      }),
    ).toThrow(/no matching inclusion found/i)
  })

  test("returns captured values when effective output type is forwarded subtype", () => {
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

    const values = resolveUnitInputValues({
      library: library as never,
      inputName: "dep",
      resolvedInput: resolved,
      dependencyInstanceType,
      captured: [{ ok: true, value: { v: 42 } }],
      effectiveOutputType: "child.v1",
      effectiveRootOutputType: "child.v1",
    })

    expect(values).toEqual([
      {
        value: { v: 42 },
        source: { instanceId: dependencyInstanceId, output: "out" },
      },
    ])
  })

  test("throws when captured value is an error", () => {
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

    expect(() =>
      resolveUnitInputValues({
        library: library as never,
        inputName: "dep",
        resolvedInput: resolved,
        dependencyInstanceType,
        captured: [
          {
            ok: false,
            error: {
              message: 'Missing required inclusion "child"',
              snapshotId: "snap_1",
            },
          },
        ],
      }),
    ).toThrow(/failed to reconstruct/i)
  })

  test("extracts values using explicit nested inclusion path", () => {
    const dependencyInstanceId = "component.v1:dep"
    const dependencyInstanceType = "component.v1" satisfies VersionedName

    const library = {
      components: {
        "component.v1": {
          outputs: {
            out: { type: "network.v1" },
          },
        },
      },
      entities: {
        "network.v1": {
          type: "network.v1",
          inclusions: [{ type: "peer.v1", field: "peer", multiple: false }],
        },
        "peer.v1": {
          type: "peer.v1",
          inclusions: [{ type: "endpoint.v1", field: "endpoints", multiple: true }],
        },
        "endpoint.v1": {
          type: "endpoint.v1",
        },
      },
    }

    const resolved: ResolvedInstanceInput = {
      input: {
        instanceId: dependencyInstanceId,
        output: "out",
        path: "peer.endpoints",
      } as never,
      type: "endpoint.v1",
    }

    const values = resolveUnitInputValues({
      library: library as never,
      inputName: "dep",
      resolvedInput: resolved,
      dependencyInstanceType,
      captured: [
        {
          ok: true,
          value: {
            peer: {
              endpoints: [{ host: "a.example" }, { host: "b.example" }],
            },
          },
        },
      ],
    })

    expect(values).toEqual([
      {
        value: { host: "a.example" },
        source: {
          instanceId: dependencyInstanceId,
          output: "out",
          path: "peer.endpoints",
        },
      },
      {
        value: { host: "b.example" },
        source: {
          instanceId: dependencyInstanceId,
          output: "out",
          path: "peer.endpoints",
        },
      },
    ])
  })

  test("throws when explicit path contains bracket syntax", () => {
    const dependencyInstanceId = "component.v1:dep"
    const dependencyInstanceType = "component.v1" satisfies VersionedName

    const library = {
      components: {
        "component.v1": {
          outputs: {
            out: { type: "peer.v1" },
          },
        },
      },
      entities: {
        "peer.v1": {
          type: "peer.v1",
          inclusions: [{ type: "endpoint.v1", field: "endpoints", multiple: true }],
        },
        "endpoint.v1": {
          type: "endpoint.v1",
        },
      },
    }

    const resolved: ResolvedInstanceInput = {
      input: {
        instanceId: dependencyInstanceId,
        output: "out",
        path: "endpoints[*]",
      } as never,
      type: "endpoint.v1",
    }

    expect(() =>
      resolveUnitInputValues({
        library: library as never,
        inputName: "dep",
        resolvedInput: resolved,
        dependencyInstanceType,
        captured: [{ ok: true, value: { endpoints: [{ host: "a.example" }] } }],
      }),
    ).toThrow(/invalid input path segment/i)
  })

  test("applies explicit path even when output type matches input type", () => {
    const dependencyInstanceId = "component.v1:dep"
    const dependencyInstanceType = "component.v1" satisfies VersionedName

    const library = {
      components: {
        "component.v1": {
          outputs: {
            out: { type: "network.v1" },
          },
        },
      },
      entities: {
        "network.v1": {
          type: "network.v1",
          inclusions: [{ type: "peer.v1", field: "peer", multiple: false }],
        },
        "peer.v1": {
          type: "peer.v1",
        },
      },
    }

    const resolved: ResolvedInstanceInput = {
      input: {
        instanceId: dependencyInstanceId,
        output: "out",
        path: "peer",
      } as never,
      // same as output type on purpose: explicit path should still be applied first
      type: "network.v1",
    }

    expect(() =>
      resolveUnitInputValues({
        library: library as never,
        inputName: "dep",
        resolvedInput: resolved,
        dependencyInstanceType,
        captured: [{ ok: true, value: { peer: { id: "p1" } } }],
      }),
    ).toThrow(/resolved path type is "peer\.v1"/i)
  })
})

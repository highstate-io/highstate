import { describe, expect, it } from "vitest"
import { HighstateSignature, objectRefSchema, objectWithIdSchema } from "./instance"
import { compact, decompact } from "./compaction"

describe("compaction", () => {
  it("roundtrips primitives", () => {
    expect(decompact(compact(null))).toBe(null)
    expect(decompact(compact(undefined))).toBe(undefined)
    expect(decompact(compact(true))).toBe(true)
    expect(decompact(compact(123))).toBe(123)
    expect(decompact(compact("abc"))).toBe("abc")
  })

  it("compacts repeated object identities", () => {
    const shared = { x: 1 }
    const value = { a: shared, b: shared }

    const compacted = compact(value)

    const compactedRecord = compacted as Record<string, unknown>
    const aResult = objectWithIdSchema.safeParse(compactedRecord.a)
    const bResult = objectRefSchema.safeParse(compactedRecord.b)

    expect(aResult.success).toBe(true)
    expect(bResult.success).toBe(true)

    const roundtripped = decompact(compacted)
    expect(roundtripped).toEqual(value)
  })

  it("does not transform children of defined objects", () => {
    const shared = { x: 1 }
    const value = { a: shared, b: shared }

    const compacted = compact(value) as Record<string, unknown>
    const aResult = objectWithIdSchema.safeParse(compacted.a)
    expect(aResult.success).toBe(true)

    const sharedInside = (aResult.data as { value: unknown }).value
    expect(objectWithIdSchema.safeParse(sharedInside).success).toBe(false)
    // Refs to already-defined outer objects are allowed inside the Id value.
    // Nested Id definitions are not.
    expect(sharedInside).toEqual(shared)
  })

  it("assigns references so outer occurrences win in bfs", () => {
    const shared = { x: 1 }
    const outer = { shared }
    const inner = { shared }

    // bfs from root sees outer first, so it must be the definition site.
    const compacted = compact({ outer, inner }) as Record<string, unknown>

    const outerResult = objectWithIdSchema.safeParse(
      (compacted.outer as Record<string, unknown>).shared,
    )
    const innerResult = objectRefSchema.safeParse(
      (compacted.inner as Record<string, unknown>).shared,
    )

    if (!outerResult.success || !innerResult.success) {
      throw new Error("Test invariant violation")
    }

    expect(innerResult.data.id).toBe(outerResult.data.id)
  })

  it("throws on unresolved refs", () => {
    const bad = {
      [HighstateSignature.Ref]: true,
      id: 123,
    }

    expect(() => decompact(bad)).toThrow(/Unresolved compacted ref id/i)
  })

  it("real world case: nested entity embedding with deduped base", () => {
    const metadata = {
      namespace: "default",
      name: "gw",
      uid: "uid-1",
      labels: { app: "demo" },
      annotations: { a: "b" },
    }

    const resourceBase = {
      clusterId: "c1",
      clusterName: "cluster",
      type: "gateway",
      metadata,
    }

    const scopedResource = {
      metadata,
      clusterId: resourceBase.clusterId,
      clusterName: resourceBase.clusterName,
      type: resourceBase.type,
      "k8s.resource.v1": resourceBase,
    }

    const gateway = {
      type: "gateway",
      metadata,
      clusterId: resourceBase.clusterId,
      clusterName: resourceBase.clusterName,
      "k8s.scoped-resource.v1": scopedResource,
      "k8s.resource.v1": resourceBase,
    }

    const compacted = compact(gateway) as Record<string, unknown>

    const metadataResult = objectWithIdSchema.safeParse(compacted.metadata)
    expect(metadataResult.success).toBe(true)

    const scopedResult = compacted["k8s.scoped-resource.v1"] as Record<string, unknown>
    const scopedMetadataRef = objectRefSchema.safeParse(scopedResult.metadata)
    expect(scopedMetadataRef.success).toBe(true)
    if (!metadataResult.success || !scopedMetadataRef.success) {
      throw new Error("Test invariant violation")
    }

    expect(scopedMetadataRef.data.id).toBe(metadataResult.data.id)

    // Once an object is defined (wrapped with Id), its subtree must remain untransformed.
    const definedMetadataValue = (metadataResult.data as { value: unknown }).value
    expect(objectWithIdSchema.safeParse(definedMetadataValue).success).toBe(false)
    // Refs to already-defined outer objects are allowed inside the Id value.
    // Nested Id definitions are not.

    expect(compacted).toMatchInlineSnapshot(`
      {
        "clusterId": "c1",
        "clusterName": "cluster",
        "k8s.resource.v1": {
          "348d020e-0d9e-4ae7-9415-b91af99f5339": true,
          "id": 2,
          "value": {
            "clusterId": "c1",
            "clusterName": "cluster",
            "metadata": {
              "6d7f9da0-9cb6-496d-b72e-cf85ee4d9cf8": true,
              "id": 1,
            },
            "type": "gateway",
          },
        },
        "k8s.scoped-resource.v1": {
          "clusterId": "c1",
          "clusterName": "cluster",
          "k8s.resource.v1": {
            "6d7f9da0-9cb6-496d-b72e-cf85ee4d9cf8": true,
            "id": 2,
          },
          "metadata": {
            "6d7f9da0-9cb6-496d-b72e-cf85ee4d9cf8": true,
            "id": 1,
          },
          "type": "gateway",
        },
        "metadata": {
          "348d020e-0d9e-4ae7-9415-b91af99f5339": true,
          "id": 1,
          "value": {
            "annotations": {
              "a": "b",
            },
            "labels": {
              "app": "demo",
            },
            "name": "gw",
            "namespace": "default",
            "uid": "uid-1",
          },
        },
        "type": "gateway",
      }
    `)

    const roundtripped = decompact(compacted)
    expect(roundtripped).toEqual(gateway)
  })
})

import {
  defineEntity,
  defineUnit,
  HighstateSignature,
  unitArtifactId,
  z,
} from "@highstate/contract"
import pino from "pino"
import { describe, expect, test, vi } from "vitest"
import type { LibraryBackend } from "../library"
import { UnitOutputService } from "./unit-output"

describe("UnitOutputService", () => {
  test("computes outputHash from non-$ outputs only", async () => {
    const testEntity = defineEntity({
      type: "test.entity.v1",
      schema: z.object({ value: z.string() }),
    })

    const testUnit = defineUnit({
      type: "component.v1",
      outputs: {
        value: testEntity,
      },
      source: {
        package: "@test/units",
        path: "unit",
      },
    })

    const libraryBackend = vi.mockObject({
      loadLibrary: vi.fn().mockResolvedValue({
        components: {
          "component.v1": testUnit.model,
        },
        entities: {
          "test.entity.v1": testEntity.model,
        },
      }),
    } as unknown as LibraryBackend)

    const service = new UnitOutputService(libraryBackend, pino({ level: "silent" }))

    const baseOutputs = {
      value: { value: { $meta: { identity: "id-1", title: "x" }, value: "hello" } },
      $statusFields: {
        value: [{ name: "status", meta: { title: "Status" }, value: "ok" }],
      },
    }

    const a = await service.parseUnitOutputs({
      libraryId: "lib",
      instanceType: "component.v1",
      outputs: baseOutputs,
    })

    const b = await service.parseUnitOutputs({
      libraryId: "lib",
      instanceType: "component.v1",
      outputs: {
        ...baseOutputs,
        $statusFields: {
          value: [{ name: "status", meta: { title: "Status" }, value: "changed" }],
        },
      },
    })

    expect(a.outputHash).not.toBeNull()
    expect(b.outputHash).toBe(a.outputHash)

    const c = await service.parseUnitOutputs({
      libraryId: "lib",
      instanceType: "component.v1",
      outputs: {
        ...baseOutputs,
        value: { value: { $meta: { identity: "id-1", title: "x" }, value: "world" } },
      },
    })

    expect(c.outputHash).not.toBe(a.outputHash)
  })

  test("parses $statusFields/$terminals/$pages/$triggers/$workers/$secrets", async () => {
    const service = new UnitOutputService(
      vi.mockObject({
        loadLibrary: vi.fn(),
      } as unknown as LibraryBackend),
      pino({ level: "silent" }),
    )

    const parsed = await service.parseUnitOutputs({
      libraryId: "lib",
      instanceType: "component.v1",
      outputs: {
        $statusFields: {
          value: [{ name: "health", meta: { title: "Health" }, value: "healthy" }],
        },
        $terminals: {
          value: [
            {
              name: "ssh",
              meta: { title: "SSH" },
              spec: { image: "alpine:3.18", command: ["sh"] },
            },
          ],
        },
        $pages: {
          value: [
            {
              name: "readme",
              meta: { title: "Readme" },
              content: [{ type: "markdown", content: "hello" }],
            },
          ],
        },
        $triggers: {
          value: [
            {
              name: "before-destroy",
              meta: { title: "Before destroy" },
              spec: { type: "before-destroy" },
            },
          ],
        },
        $workers: {
          value: [{ name: "worker", image: "alpine:3.18", params: { a: 1 } }],
        },
        $secrets: {
          value: { token: "secret" },
        },
      },
    })

    expect(parsed.outputHash).toBeNull()
    expect(parsed.entitySnapshotPayload).toBeNull()
    expect(parsed.statusFields?.[0]?.name).toBe("health")
    expect(parsed.terminals?.[0]?.name).toBe("ssh")
    expect(parsed.pages?.[0]?.name).toBe("readme")
    expect(parsed.triggers?.[0]?.name).toBe("before-destroy")
    expect(parsed.workers?.[0]?.name).toBe("worker")
    expect(parsed.secrets).toEqual({ token: "secret" })
  })

  test("extracts exportedArtifactIds from $artifacts", async () => {
    const service = new UnitOutputService(
      vi.mockObject({
        loadLibrary: vi.fn(),
      } as unknown as LibraryBackend),
      pino({ level: "silent" }),
    )

    const parsed = await service.parseUnitOutputs({
      libraryId: "lib",
      instanceType: "component.v1",
      outputs: {
        $artifacts: {
          value: {
            output: [
              {
                [HighstateSignature.Artifact]: true,
                [unitArtifactId]: "artifact-1",
                hash: "hash-1",
              },
            ],
          },
        },
      },
    })

    expect(parsed.exportedArtifactIds).toEqual({ output: ["artifact-1"] })
  })

  test("throws when $artifacts item misses unitArtifactId", async () => {
    const service = new UnitOutputService(
      vi.mockObject({
        loadLibrary: vi.fn(),
      } as unknown as LibraryBackend),
      pino({ level: "silent" }),
    )

    await expect(
      service.parseUnitOutputs({
        libraryId: "lib",
        instanceType: "component.v1",
        outputs: {
          $artifacts: {
            value: {
              output: [
                {
                  [HighstateSignature.Artifact]: true,
                  hash: "hash-missing-id",
                },
              ],
            },
          },
        },
      }),
    ).rejects.toThrow("Failed to determine artifact ID for artifact with hash hash-missing-id")
  })

  test("builds entitySnapshotPayload using static output specs and entity inclusions", async () => {
    const childEntity = defineEntity({
      type: "child.v1",
      schema: z.object({ name: z.string() }),
    })

    const parentEntity = defineEntity({
      type: "parent.v1",
      schema: z.object({ name: z.string() }),
      includes: {
        childOne: childEntity,
        childTwo: childEntity,
        children: { entity: childEntity, multiple: true, required: false },
      },
    })

    const testUnit = defineUnit({
      type: "component.v1",
      outputs: {
        parent: parentEntity,
        parents: { entity: parentEntity, multiple: true },
      },
      source: {
        package: "@test/units",
        path: "unit",
      },
    })

    const library = {
      components: {
        "component.v1": testUnit.model,
      },
      entities: {
        "child.v1": childEntity.model,
        "parent.v1": parentEntity.model,
      },
    }

    const libraryBackend = vi.mockObject({
      loadLibrary: vi.fn().mockResolvedValue(library),
    } as unknown as LibraryBackend)

    const service = new UnitOutputService(libraryBackend, pino({ level: "silent" }))

    const anonymousChild = {
      $meta: { title: "Anon child" },
      name: "child-1",
    }

    const parsed = await service.parseUnitOutputs({
      libraryId: "lib",
      instanceType: "component.v1",
      outputs: {
        parent: {
          value: {
            $meta: {
              // must not affect derived type
              type: "child.v1",
              identity: "parent-1",
              title: "Parent Title",
              references: ["external-ref", 123, null],
            },
            name: "p",
            childOne: anonymousChild,
            childTwo: anonymousChild,
            children: [
              anonymousChild,
              { $meta: { identity: "child-2", title: "Child 2" }, name: "c2" },
            ],
          },
        },
        parents: {
          value: [
            { $meta: { identity: "dup", title: "First" }, name: "x" },
            { $meta: { identity: "dup", title: "Second" }, name: "y" },
          ],
        },
      },
    })

    const payload = parsed.entitySnapshotPayload
    expect(payload).not.toBeNull()

    const nodes = payload!.nodes
    const parentNodes = nodes.filter(n => n.entityType === "parent.v1")
    const childNodes = nodes.filter(n => n.entityType === "child.v1")

    expect(parentNodes).toHaveLength(2)
    expect(childNodes).toHaveLength(2)

    const parent = nodes.find(n => n.output === "parent")
    expect(parent?.entityType).toBe("parent.v1")
    expect(parent?.identity).toBe("parent-1")
    expect(parent?.explicitReferences).toEqual(["external-ref"])
    expect(parent?.meta.title).toBe("Parent Title")
    expect(parent?.content).not.toHaveProperty("$meta")

    const duplicateParents = nodes.filter(n => n.output === "parents" && n.identity === "dup")
    expect(duplicateParents).toHaveLength(1)

    const anonChildNodes = nodes.filter(
      n => n.output === "parent" && n.entityType === "child.v1" && !n.identity,
    )
    expect(anonChildNodes).toHaveLength(1)

    const anonChildNodeId = anonChildNodes[0]?.nodeId
    const implicitFromParent = payload!.implicitReferences.filter(
      r => r.fromNodeId === parent?.nodeId,
    )
    const implicitToAnonChild = implicitFromParent.filter(r => r.toNodeId === anonChildNodeId)
    expect(implicitToAnonChild.length).toBeGreaterThanOrEqual(2)
  })
})

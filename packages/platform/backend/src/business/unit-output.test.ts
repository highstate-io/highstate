import type { LibraryBackend } from "../library"
import {
  defineEntity,
  defineUnit,
  HighstateSignature,
  unitArtifactId,
  z,
} from "@highstate/contract"
import pino from "pino"
import { describe, expect, test, vi } from "vitest"
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
      value: {
        value: {
          $meta: { type: "test.entity.v1", identity: "id-1", title: "x" },
          value: "hello",
        },
      },
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
        value: {
          value: {
            $meta: { type: "test.entity.v1", identity: "id-1", title: "x" },
            value: "world",
          },
        },
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
    expect(parsed.hasResourceHooks).toBe(false)
  })

  test("parses $hasResourceHooks", async () => {
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
        $hasResourceHooks: { value: true },
      },
    })

    expect(parsed.hasResourceHooks).toBe(true)
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

    const childOne = {
      $meta: { type: "child.v1", identity: "child-1", title: "Child 1" },
      name: "child-1",
    }

    const childTwo = {
      $meta: { type: "child.v1", identity: "child-2", title: "Child 2" },
      name: "child-2",
    }

    const parsed = await service.parseUnitOutputs({
      libraryId: "lib",
      instanceType: "component.v1",
      outputs: {
        parent: {
          value: {
            $meta: {
              type: "parent.v1",
              identity: "parent-1",
              title: "Parent Title",
              references: {
                deps: ["external-ref"],
              },
            },
            name: "p",
            childOne: childOne,
            childTwo: childTwo,
            children: [childOne, childTwo],
          },
        },
        parents: {
          value: [
            {
              $meta: { type: "parent.v1", identity: "dup", title: "First" },
              name: "x",
              childOne: childOne,
              childTwo: childTwo,
            },
            {
              $meta: { type: "parent.v1", identity: "dup", title: "Second" },
              name: "y",
              childOne: childOne,
              childTwo: childTwo,
            },
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

    const parent = nodes.find(n => n.entityType === "parent.v1" && n.identity === "parent-1")
    expect(parent?.entityType).toBe("parent.v1")
    expect(parent?.identity).toBe("parent-1")
    expect(payload?.explicitReferences).toEqual([
      { fromEntityId: parent!.entityId, toEntityId: "external-ref", group: "deps" },
    ])
    expect(parent?.meta?.title).toBe("Parent Title")
    expect(parent?.content).not.toHaveProperty("$meta")
    expect(parent?.content).not.toHaveProperty("childOne")
    expect(parent?.content).not.toHaveProperty("childTwo")
    expect(parent?.content).not.toHaveProperty("children")
    expect(parent?.exportedOutputs).toEqual(["parent"])

    const child1 = nodes.find(n => n.entityType === "child.v1" && n.identity === "child-1")
    const child2 = nodes.find(n => n.entityType === "child.v1" && n.identity === "child-2")
    expect(child1?.referencedOutputs).toEqual(expect.arrayContaining(["parent", "parents"]))
    expect(child1?.exportedOutputs).toEqual([])
    expect(child2?.referencedOutputs).toEqual(expect.arrayContaining(["parent", "parents"]))
    expect(child2?.exportedOutputs).toEqual([])

    const duplicateParents = nodes.filter(n => n.entityType === "parent.v1" && n.identity === "dup")
    expect(duplicateParents).toHaveLength(1)
    expect(duplicateParents[0]?.exportedOutputs).toEqual(["parents"])

    const implicitFromParent = payload!.implicitReferences.filter(
      r => r.fromEntityId === parent!.entityId,
    )
    expect(implicitFromParent).toEqual(
      expect.arrayContaining([
        { fromEntityId: parent!.entityId, toEntityId: child1!.entityId, group: "childOne" },
        { fromEntityId: parent!.entityId, toEntityId: child2!.entityId, group: "childTwo" },
        { fromEntityId: parent!.entityId, toEntityId: child1!.entityId, group: "children" },
        { fromEntityId: parent!.entityId, toEntityId: child2!.entityId, group: "children" },
      ]),
    )
  })

  test("keeps entity snapshot meta null when no UI meta fields are provided", async () => {
    const entity = defineEntity({
      type: "test.entity.v1",
      schema: z.object({ value: z.string() }),
    })

    const unit = defineUnit({
      type: "component.v1",
      outputs: {
        value: entity,
      },
      source: {
        package: "@test/units",
        path: "unit",
      },
    })

    const libraryBackend = vi.mockObject({
      loadLibrary: vi.fn().mockResolvedValue({
        components: {
          "component.v1": unit.model,
        },
        entities: {
          "test.entity.v1": entity.model,
        },
      }),
    } as unknown as LibraryBackend)

    const service = new UnitOutputService(libraryBackend, pino({ level: "silent" }))

    const parsed = await service.parseUnitOutputs({
      libraryId: "lib",
      instanceType: "component.v1",
      outputs: {
        value: {
          value: {
            $meta: { type: "test.entity.v1", identity: "id-1" },
            value: "hello",
          },
        },
      },
    })

    const payload = parsed.entitySnapshotPayload
    expect(payload).not.toBeNull()
    expect(payload!.nodes).toHaveLength(1)
    expect(payload!.nodes[0]?.meta).toBeNull()
  })

  test("accepts inherited entity types in outputs", async () => {
    const baseEntity = defineEntity({
      type: "base.v1",
      schema: z.object({ base: z.string() }),
    })

    const derivedEntity = defineEntity({
      type: "derived.v1",
      extends: {
        base: baseEntity,
      },
      schema: z.object({ derived: z.string() }),
    })

    const unit = defineUnit({
      type: "component.v1",
      outputs: {
        value: baseEntity,
      },
      source: {
        package: "@test/units",
        path: "unit",
      },
    })

    const libraryBackend = vi.mockObject({
      loadLibrary: vi.fn().mockResolvedValue({
        components: {
          "component.v1": unit.model,
        },
        entities: {
          "base.v1": baseEntity.model,
          "derived.v1": derivedEntity.model,
        },
      }),
    } as unknown as LibraryBackend)

    const service = new UnitOutputService(libraryBackend, pino({ level: "silent" }))

    const parsed = await service.parseUnitOutputs({
      libraryId: "lib",
      instanceType: "component.v1",
      outputs: {
        value: {
          value: {
            $meta: { type: "derived.v1", identity: "id-1" },
            base: "x",
            derived: "y",
          },
        },
      },
    })

    expect(parsed.entitySnapshotError).toBeNull()
    expect(parsed.entitySnapshotPayload?.nodes).toHaveLength(1)
    expect(parsed.entitySnapshotPayload?.nodes[0]?.entityType).toBe("derived.v1")
  })
})

import type { ProjectDatabase } from "../database"
import type { ObjectRefIndexService } from "./object-ref-index"
import { getEntityId } from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"
import { describe, vi } from "vitest"
import { test } from "../test-utils"
import { EntitySnapshotService } from "./entity-snapshot"

const entitySnapshotTest = test.extend<{
  entitySnapshotService: EntitySnapshotService
}>({
  entitySnapshotService: async ({ database, logger }, use) => {
    const service = new EntitySnapshotService(
      database,
      vi.mockObject({
        track: vi.fn().mockResolvedValue(undefined),
      } as unknown as ObjectRefIndexService),
      logger.child({ service: "EntitySnapshotService" }),
    )

    await use(service)
  },
})

async function createOperation(projectDatabase: ProjectDatabase): Promise<{
  id: string
}> {
  const operation = await projectDatabase.operation.create({
    data: {
      id: createId(),
      meta: { title: "Test Operation" },
      type: "update",
      options: {},
      requestedInstanceIds: ["server.v1:test"],
      startedAt: new Date(),
    },
    select: { id: true },
  })

  return operation
}

describe("persistUnitEntitySnapshots", () => {
  entitySnapshotTest(
    "persists deterministic entities and snapshots",
    async ({ entitySnapshotService, projectDatabase, project, createInstanceState, expect }) => {
      const operation = await createOperation(projectDatabase)
      const state = await createInstanceState(project.id)

      const deterministicEntityId = getEntityId({
        $meta: { type: "test.entity.v1", identity: "id-1" },
      })

      const deterministicEntityId2 = getEntityId({
        $meta: { type: "test.entity.v1", identity: "id-2" },
      })

      await entitySnapshotService.persistUnitEntitySnapshots({
        projectId: project.id,
        operationId: operation.id,
        stateId: state.id,
        payload: {
          nodes: [
            {
              entityId: deterministicEntityId,
              entityType: "test.entity.v1",
              identity: "id-1",
              meta: { title: "Deterministic" },
              content: { value: "hello" },
              referencedOutputs: [],
              exportedOutputs: ["value"],
            },
            {
              entityId: deterministicEntityId2,
              entityType: "test.entity.v1",
              identity: "id-2",
              meta: { title: "Second" },
              content: { value: "world" },
              referencedOutputs: [],
              exportedOutputs: ["value"],
            },
          ],
          implicitReferences: [],
          explicitReferences: [],
        },
      })

      const deterministicEntity = await projectDatabase.entity.findUnique({
        where: { id: deterministicEntityId },
      })
      expect(deterministicEntity?.id).toBe(deterministicEntityId)
      expect(deterministicEntity?.identity).toBe("id-1")

      const snapshots = await projectDatabase.entitySnapshot.findMany({
        where: { operationId: operation.id, stateId: state.id },
        orderBy: { createdAt: "asc" },
      })
      expect(snapshots).toHaveLength(2)

      const deterministicSnapshot = snapshots.find(s => s.entityId === deterministicEntityId)
      expect(deterministicSnapshot).toBeDefined()
      expect(deterministicSnapshot?.id).not.toBe(deterministicEntityId)
    },
  )

  entitySnapshotTest(
    "creates implicit + explicit snapshot references",
    async ({ entitySnapshotService, projectDatabase, project, createInstanceState, expect }) => {
      const operation = await createOperation(projectDatabase)
      const state = await createInstanceState(project.id)

      const referencedEntityId = getEntityId({
        $meta: { type: "ref.v1", identity: "ref-1" },
      })

      const fromEntityId = getEntityId({
        $meta: { type: "from.v1", identity: "from-1" },
      })

      await entitySnapshotService.persistUnitEntitySnapshots({
        projectId: project.id,
        operationId: operation.id,
        stateId: state.id,
        payload: {
          nodes: [
            {
              entityId: fromEntityId,
              entityType: "from.v1",
              identity: "from-1",
              meta: { title: "From" },
              content: { v: 1 },
              referencedOutputs: [],
              exportedOutputs: ["out"],
            },
            {
              entityId: referencedEntityId,
              entityType: "ref.v1",
              identity: "ref-1",
              meta: { title: "To" },
              content: { v: 2 },
              referencedOutputs: [],
              exportedOutputs: ["out"],
            },
          ],
          implicitReferences: [
            { fromEntityId: fromEntityId, toEntityId: referencedEntityId, group: "child" },
            { fromEntityId: fromEntityId, toEntityId: referencedEntityId, group: "child" },
          ],
          explicitReferences: [
            { fromEntityId: fromEntityId, toEntityId: referencedEntityId, group: "deps" },
          ],
        },
      })

      const allSnapshots = await projectDatabase.entitySnapshot.findMany({
        where: { operationId: operation.id, stateId: state.id },
        select: { id: true, entityId: true },
      })

      const fromSnapshot = allSnapshots.find(s => s.entityId === fromEntityId)
      const toSnapshot = allSnapshots.find(s => s.entityId === referencedEntityId)

      expect(fromSnapshot).toBeDefined()
      expect(toSnapshot).toBeDefined()

      const refs = await projectDatabase.entitySnapshotReference.findMany({
        where: { fromId: fromSnapshot?.id },
        orderBy: [{ toId: "asc" }, { kind: "asc" }, { group: "asc" }],
      })

      expect(refs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fromId: fromSnapshot!.id,
            toId: toSnapshot!.id,
            kind: "inclusion",
            group: "child",
          }),
          expect.objectContaining({
            fromId: fromSnapshot!.id,
            toId: toSnapshot!.id,
            kind: "explicit",
            group: "deps",
          }),
        ]),
      )

      const uniqueEdges = new Set(refs.map(r => `${r.fromId}:${r.toId}:${r.kind}:${r.group}`))
      expect(uniqueEdges.size).toBe(refs.length)
    },
  )

  entitySnapshotTest(
    "throws when explicit reference points to missing entity",
    async ({ entitySnapshotService, projectDatabase, project, createInstanceState, expect }) => {
      const operation = await createOperation(projectDatabase)
      const state = await createInstanceState(project.id)

      const fromEntityId = getEntityId({
        $meta: { type: "from.v1", identity: "from-1" },
      })

      await expect(
        entitySnapshotService.persistUnitEntitySnapshots({
          projectId: project.id,
          operationId: operation.id,
          stateId: state.id,
          payload: {
            nodes: [
              {
                entityId: fromEntityId,
                entityType: "from.v1",
                identity: "from-1",
                meta: { title: "From" },
                content: { v: 1 },
                referencedOutputs: [],
                exportedOutputs: ["out"],
              },
            ],
            implicitReferences: [],
            explicitReferences: [
              { fromEntityId: fromEntityId, toEntityId: "missing-entity", group: "deps" },
            ],
          },
        }),
      ).rejects.toThrow('Referenced entity "missing-entity" does not exist')
    },
  )

  entitySnapshotTest(
    "persists snapshot meta as null when not provided",
    async ({ entitySnapshotService, projectDatabase, project, createInstanceState, expect }) => {
      const operation = await createOperation(projectDatabase)
      const state = await createInstanceState(project.id)

      const entityId = getEntityId({
        $meta: { type: "test.entity.v1", identity: "id-1" },
      })

      await entitySnapshotService.persistUnitEntitySnapshots({
        projectId: project.id,
        operationId: operation.id,
        stateId: state.id,
        payload: {
          nodes: [
            {
              entityId,
              entityType: "test.entity.v1",
              identity: "id-1",
              meta: null,
              content: { value: "hello" },
              referencedOutputs: [],
              exportedOutputs: ["value"],
            },
          ],
          implicitReferences: [],
          explicitReferences: [],
        },
      })

      const snapshot = await projectDatabase.entitySnapshot.findFirst({
        where: { operationId: operation.id, stateId: state.id, entityId },
        select: {
          content: {
            select: { meta: true },
          },
        },
      })

      expect(snapshot?.content.meta).toBeNull()
    },
  )
})

describe("listReferencedEntitySnapshotsForOutput", () => {
  entitySnapshotTest(
    "returns snapshots when output is exported",
    async ({ entitySnapshotService, projectDatabase, project, createInstanceState, expect }) => {
      const operation = await createOperation(projectDatabase)
      const state = await createInstanceState(project.id)

      const entityId = getEntityId({
        $meta: { type: "test.entity.v1", identity: "id-1" },
      })

      await entitySnapshotService.persistUnitEntitySnapshots({
        projectId: project.id,
        operationId: operation.id,
        stateId: state.id,
        payload: {
          nodes: [
            {
              entityId,
              entityType: "test.entity.v1",
              identity: "id-1",
              meta: { title: "Exported" },
              content: { value: "hello" },
              referencedOutputs: [],
              exportedOutputs: ["value"],
            },
          ],
          implicitReferences: [],
          explicitReferences: [],
        },
      })

      const snapshots = await entitySnapshotService.listReferencedEntitySnapshotsForOutput(
        project.id,
        state.id,
        "value",
      )

      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]).toEqual(
        expect.objectContaining({
          entityId,
          entityType: "test.entity.v1",
          entityIdentity: "id-1",
          content: { value: "hello" },
        }),
      )
    },
  )

  entitySnapshotTest(
    "returns snapshots when output is only referenced",
    async ({ entitySnapshotService, projectDatabase, project, createInstanceState, expect }) => {
      const operation = await createOperation(projectDatabase)
      const state = await createInstanceState(project.id)

      const entityId = getEntityId({
        $meta: { type: "test.entity.v1", identity: "id-1" },
      })

      await entitySnapshotService.persistUnitEntitySnapshots({
        projectId: project.id,
        operationId: operation.id,
        stateId: state.id,
        payload: {
          nodes: [
            {
              entityId,
              entityType: "test.entity.v1",
              identity: "id-1",
              meta: { title: "Referenced" },
              content: { value: "hello" },
              referencedOutputs: ["value"],
              exportedOutputs: [],
            },
          ],
          implicitReferences: [],
          explicitReferences: [],
        },
      })

      const snapshots = await entitySnapshotService.listReferencedEntitySnapshotsForOutput(
        project.id,
        state.id,
        "value",
      )

      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]).toEqual(
        expect.objectContaining({
          entityId,
          entityType: "test.entity.v1",
          entityIdentity: "id-1",
          content: { value: "hello" },
        }),
      )
    },
  )

  entitySnapshotTest(
    "can reconstruct snapshot values with $meta and inclusions",
    async ({ entitySnapshotService, projectDatabase, project, createInstanceState, expect }) => {
      const operation = await createOperation(projectDatabase)
      const state = await createInstanceState(project.id)

      const parentEntityId = getEntityId({
        $meta: { type: "parent.v1", identity: "p1" },
      })

      const childEntityId = getEntityId({
        $meta: { type: "child.v1", identity: "c1" },
      })

      await entitySnapshotService.persistUnitEntitySnapshots({
        projectId: project.id,
        operationId: operation.id,
        stateId: state.id,
        payload: {
          nodes: [
            {
              entityId: parentEntityId,
              entityType: "parent.v1",
              identity: "p1",
              meta: { title: "Parent" },
              content: { value: "p" },
              referencedOutputs: [],
              exportedOutputs: ["out"],
            },
            {
              entityId: childEntityId,
              entityType: "child.v1",
              identity: "c1",
              meta: { title: "Child" },
              content: { value: "c" },
              referencedOutputs: ["out"],
              exportedOutputs: [],
            },
          ],
          implicitReferences: [
            {
              fromEntityId: parentEntityId,
              toEntityId: childEntityId,
              group: "child",
            },
          ],
          explicitReferences: [],
        },
      })

      const library = {
        components: {},
        entities: {
          "parent.v1": {
            type: "parent.v1",
            inclusions: [
              {
                type: "child.v1",
                field: "child",
                required: false,
                multiple: false,
              },
            ],
          },
          "child.v1": { type: "child.v1", inclusions: [] },
        },
      }

      const snapshots = await entitySnapshotService.listReferencedEntitySnapshotsForOutput(
        project.id,
        state.id,
        "out",
        library as never,
      )

      expect(snapshots).toHaveLength(2)

      const parent = snapshots.find(s => s.entityId === parentEntityId)
      expect(parent?.content).toMatchObject({
        $meta: { type: "parent.v1", identity: "p1", title: "Parent" },
        value: "p",
        child: {
          $meta: { type: "child.v1", identity: "c1", title: "Child" },
          value: "c",
        },
      })

      expect((parent?.content as { $meta?: unknown } | undefined)?.$meta).toMatchObject({
        snapshotId: expect.any(String),
      })
    },
  )
})

describe("reconstructLatestExportedOutputValues", () => {
  entitySnapshotTest(
    "returns most recent exported values and does not cross-product keys",
    async ({ entitySnapshotService, projectDatabase, project, createInstanceState, expect }) => {
      const stateA = await createInstanceState(project.id)
      const stateB = await createInstanceState(project.id)

      const op1 = await createOperation(projectDatabase)
      const op2 = await createOperation(projectDatabase)

      await entitySnapshotService.persistUnitEntitySnapshots({
        projectId: project.id,
        operationId: op1.id,
        stateId: stateA.id,
        payload: {
          nodes: [
            {
              entityId: getEntityId({ $meta: { type: "a.v1", identity: "a1" } }),
              entityType: "a.v1",
              identity: "a1",
              meta: { title: "A/outA" },
              content: { n: 1 },
              referencedOutputs: [],
              exportedOutputs: ["outA"],
            },
            {
              entityId: getEntityId({ $meta: { type: "a.v1", identity: "a2" } }),
              entityType: "a.v1",
              identity: "a2",
              meta: { title: "A/outB" },
              content: { n: 2 },
              referencedOutputs: [],
              exportedOutputs: ["outB"],
            },
          ],
          implicitReferences: [],
          explicitReferences: [],
        },
      })

      await entitySnapshotService.persistUnitEntitySnapshots({
        projectId: project.id,
        operationId: op1.id,
        stateId: stateB.id,
        payload: {
          nodes: [
            {
              entityId: getEntityId({ $meta: { type: "b.v1", identity: "b1" } }),
              entityType: "b.v1",
              identity: "b1",
              meta: { title: "B/outA" },
              content: { n: 3 },
              referencedOutputs: [],
              exportedOutputs: ["outA"],
            },
            {
              entityId: getEntityId({ $meta: { type: "b.v1", identity: "b2" } }),
              entityType: "b.v1",
              identity: "b2",
              meta: { title: "B/outB" },
              content: { n: 4 },
              referencedOutputs: [],
              exportedOutputs: ["outB"],
            },
          ],
          implicitReferences: [],
          explicitReferences: [],
        },
      })

      await entitySnapshotService.persistUnitEntitySnapshots({
        projectId: project.id,
        operationId: op2.id,
        stateId: stateA.id,
        payload: {
          nodes: [
            {
              entityId: getEntityId({ $meta: { type: "a.v1", identity: "a3" } }),
              entityType: "a.v1",
              identity: "a3",
              meta: { title: "A/outA newer" },
              content: { n: 10 },
              referencedOutputs: [],
              exportedOutputs: ["outA"],
            },
          ],
          implicitReferences: [],
          explicitReferences: [],
        },
      })

      const t1 = new Date("2020-01-01T00:00:00.000Z")
      const t2 = new Date("2020-01-02T00:00:00.000Z")

      const op1Snapshots = await projectDatabase.entitySnapshot.findMany({
        where: { operationId: op1.id },
        select: { id: true },
      })
      const op2Snapshots = await projectDatabase.entitySnapshot.findMany({
        where: { operationId: op2.id },
        select: { id: true },
      })

      for (const s of op1Snapshots) {
        await projectDatabase.entitySnapshot.update({
          where: { id: s.id },
          data: { createdAt: t1 },
        })
      }

      for (const s of op2Snapshots) {
        await projectDatabase.entitySnapshot.update({
          where: { id: s.id },
          data: { createdAt: t2 },
        })
      }

      const library = {
        components: {},
        entities: {
          "a.v1": { type: "a.v1", inclusions: [] },
          "b.v1": { type: "b.v1", inclusions: [] },
        },
      }

      const captured = await entitySnapshotService.reconstructLatestExportedOutputValues(
        project.id,
        [
          { stateId: stateA.id, output: "outA" },
          { stateId: stateB.id, output: "outB" },
        ],
        library as never,
      )

      expect(Array.from(captured.keys()).sort()).toEqual(
        [`${stateA.id}:outA`, `${stateB.id}:outB`].sort(),
      )

      const newerValues = captured.get(`${stateA.id}:outA`) ?? []
      expect(newerValues).toHaveLength(1)
      expect(newerValues[0]).toMatchObject({ ok: true })
      if (newerValues[0]?.ok) {
        expect(newerValues[0].value).toMatchObject({
          $meta: { type: "a.v1", identity: "a3" },
          n: 10,
        })

        expect(newerValues[0].value.$meta).not.toHaveProperty("snapshotId")
      }

      const bOutB = captured.get(`${stateB.id}:outB`) ?? []
      expect(bOutB).toHaveLength(1)
      expect(bOutB[0]).toMatchObject({ ok: true })
      if (bOutB[0]?.ok) {
        expect(bOutB[0].value).toMatchObject({
          $meta: { type: "b.v1", identity: "b2" },
          n: 4,
        })

        expect(bOutB[0].value.$meta).not.toHaveProperty("snapshotId")
      }
    },
  )

  entitySnapshotTest(
    "captures reconstruction errors (missing required inclusion) instead of throwing",
    async ({ entitySnapshotService, projectDatabase, project, createInstanceState, expect }) => {
      const operation = await createOperation(projectDatabase)
      const state = await createInstanceState(project.id)

      await entitySnapshotService.persistUnitEntitySnapshots({
        projectId: project.id,
        operationId: operation.id,
        stateId: state.id,
        payload: {
          nodes: [
            {
              entityId: getEntityId({ $meta: { type: "parent.v1", identity: "p1" } }),
              entityType: "parent.v1",
              identity: "p1",
              meta: { title: "Parent" },
              content: { value: "p" },
              referencedOutputs: [],
              exportedOutputs: ["out"],
            },
          ],
          implicitReferences: [],
          explicitReferences: [],
        },
      })

      const library = {
        components: {},
        entities: {
          "parent.v1": {
            type: "parent.v1",
            inclusions: [{ type: "child.v1", field: "child", required: true }],
          },
          "child.v1": { type: "child.v1", inclusions: [] },
        },
      }

      const captured = await entitySnapshotService.reconstructLatestExportedOutputValues(
        project.id,
        [{ stateId: state.id, output: "out", operationId: operation.id }],
        library as never,
      )

      const values = captured.get(`${state.id}:out`) ?? []
      expect(values).toHaveLength(1)
      expect(values[0]).toMatchObject({ ok: false })
      if (values[0] && !values[0].ok) {
        expect(values[0].error.message).toMatch(/missing required inclusion/i)
      }
    },
  )
})

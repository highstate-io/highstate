import { crc32 } from "node:zlib"
import { defineEntity, defineUnit, getEntityId, type InstanceModel, z } from "@highstate/contract"
import { sha256 } from "@noble/hashes/sha2"
import { generateIdentity, identityToRecipient } from "age-encryption"
import { Buffer } from "buffer-polyfill"
import { describe, expect } from "vitest"
import {
  type LibraryModel,
  type ResolvedInstanceInput,
  SYSTEM_EXPORT_COMPONENT_TYPE,
} from "../shared"
import { test } from "../test-utils"
import { ProjectPortService } from "./project-port"

const projectPortTest = test.extend<{
  projectPortService: ProjectPortService
}>({
  projectPortService: async ({ database }, use) => {
    const service = new ProjectPortService(database)

    await use(service)
  },
})

function makePayload(suffix: string) {
  return {
    meta: {
      title: `Export ${suffix}`,
      description: `Payload ${suffix}`,
      icon: "mdi:export",
      iconColor: "#0284c7",
    },
    outputs: {},
    entities: [],
    references: [],
  }
}

describe("ProjectPortService", () => {
  projectPortTest("detects import and export port types", async ({ projectPortService }) => {
    expect(projectPortService.isExportPortType(SYSTEM_EXPORT_COMPONENT_TYPE)).toBe(true)
    expect(projectPortService.isExportPortType("component.v1")).toBe(false)

    expect(projectPortService.isImportPortType("system.import.state-1.v1")).toBe(true)
    expect(projectPortService.isImportPortType("system.import.state-1.v2")).toBe(false)
    expect(projectPortService.isImportPortType("component.v1")).toBe(false)
  })

  projectPortTest("extracts import source state IDs", async ({ projectPortService }) => {
    expect(projectPortService.extractImportSourceStateId("system.import.state-1.v1")).toBe(
      "state-1",
    )
    expect(projectPortService.extractImportSourceStateId(SYSTEM_EXPORT_COMPONENT_TYPE)).toBeNull()
  })

  projectPortTest(
    "builds export payload from persisted snapshot graph",
    async ({ projectPortService }) => {
      const entity = defineEntity({
        type: "test.entity.v1",
        schema: z.object({ value: z.string() }),
      })

      const sourceUnit = defineUnit({
        type: "test.component.v1",
        outputs: {
          entity,
        },
        source: {
          package: "@test/unit",
          path: "unit",
        },
      })

      const library: LibraryModel = {
        components: {
          "test.component.v1": sourceUnit.model,
        },
        entities: {
          "test.entity.v1": entity.model,
        },
      }

      const exportPort: InstanceModel = {
        id: `${SYSTEM_EXPORT_COMPONENT_TYPE}:shared-port`,
        kind: "unit",
        type: SYSTEM_EXPORT_COMPONENT_TYPE,
        name: "shared-port",
      }

      const dependency: InstanceModel = {
        id: "test.component.v1:source",
        kind: "unit",
        type: "test.component.v1",
        name: "source",
      }

      const resolvedInputs: Record<string, ResolvedInstanceInput[]> = {
        server: [
          {
            input: {
              instanceId: dependency.id,
              output: "entity",
            },
            type: "test.entity.v1",
          },
        ],
      }

      const rootId = getEntityId({
        $meta: {
          type: "test.entity.v1",
          identity: "entity-1",
        },
      } as never)

      const childId = getEntityId({
        $meta: {
          type: "test.entity.v1",
          identity: "entity-2",
        },
      } as never)

      const payload = await projectPortService.buildExportPayloadFromSnapshots({
        projectName: "source-project",
        instance: exportPort,
        resolvedInputs,
        library,
        tryGetInstance: instanceId => (instanceId === dependency.id ? dependency : undefined),
        tryGetStateId: instanceId => (instanceId === dependency.id ? "state-1" : undefined),
        getExportedOutputGraph: async () => ({
          rootEntityIds: [rootId],
          entities: [
            {
              entityId: rootId,
              type: "test.entity.v1",
              identity: "entity-1",
              meta: { title: "Entity 1" },
              content: { value: "hello" },
            },
            {
              entityId: childId,
              type: "test.entity.v1",
              identity: "entity-2",
              meta: { title: "Entity 2" },
              content: { value: "nested" },
            },
          ],
          references: [
            {
              fromEntityId: rootId,
              toEntityId: childId,
              group: "endpoints",
            },
          ],
        }),
      })

      expect(payload.meta.title).toBe("source-project/shared-port")
      expect(Object.keys(payload.outputs)).toEqual(["server"])
      expect(payload.entities).toHaveLength(2)

      const rootEntity = payload.entities.find(item => item.identity === "entity-1")
      const childEntity = payload.entities.find(item => item.identity === "entity-2")

      expect(rootEntity?.exportedInOutputs).toEqual(["server"])
      expect(rootEntity?.referencedInOutputs).toEqual(["server"])
      expect(childEntity?.exportedInOutputs).toEqual([])
      expect(childEntity?.referencedInOutputs).toEqual(["server"])
      expect(payload.references).toEqual([
        {
          fromId: rootId,
          toId: childId,
          kind: "inclusion",
          group: "endpoints",
        },
      ])
    },
  )

  projectPortTest(
    "uses export-port input name and resolved type for forwarded producer outputs",
    async ({ projectPortService }) => {
      const sourceEntity = defineEntity({
        type: "wireguard.config.v1",
        schema: z.object({ value: z.string() }),
      })

      const producer = defineUnit({
        type: "common.filter.v1",
        inputs: {
          entities: {
            entity: sourceEntity,
            multiple: true,
          },
        },
        outputs: {
          entities: {
            fromInput: "entities",
            multiple: true,
          },
        },
        source: {
          package: "@test/unit",
          path: "unit",
        },
      })

      const library: LibraryModel = {
        components: {
          "common.filter.v1": producer.model,
        },
        entities: {
          "wireguard.config.v1": sourceEntity.model,
        },
      }

      const exportPort: InstanceModel = {
        id: `${SYSTEM_EXPORT_COMPONENT_TYPE}:storage`,
        kind: "unit",
        type: SYSTEM_EXPORT_COMPONENT_TYPE,
        name: "storage",
        inputs: {
          vpnPeer: [{ instanceId: "common.filter.v1:filter-2", output: "entities" }],
        },
      }

      const dependency: InstanceModel = {
        id: "common.filter.v1:filter-2",
        kind: "unit",
        type: "common.filter.v1",
        name: "filter-2",
      }

      const resolvedInputs: Record<string, ResolvedInstanceInput[]> = {
        entities: [
          {
            input: {
              instanceId: dependency.id,
              output: "entities",
            },
            type: "wireguard.config.v1",
          },
        ],
      }

      const rootId = getEntityId({
        $meta: {
          type: "wireguard.config.v1",
          identity: "cfg-1",
        },
      } as never)

      const payload = await projectPortService.buildExportPayloadFromSnapshots({
        projectName: "source-project",
        instance: exportPort,
        resolvedInputs,
        library,
        tryGetInstance: instanceId => (instanceId === dependency.id ? dependency : undefined),
        tryGetStateId: instanceId => (instanceId === dependency.id ? "state-1" : undefined),
        getExportedOutputGraph: async () => ({
          rootEntityIds: [rootId],
          entities: [
            {
              entityId: rootId,
              type: "wireguard.config.v1",
              identity: "cfg-1",
              meta: {},
              content: { value: "ok" },
            },
          ],
          references: [],
        }),
      })

      expect(Object.keys(payload.outputs)).toEqual(["vpnPeer"])
      expect(payload.outputs.vpnPeer?.type).toBe("wireguard.config.v1")
      expect(payload.outputs.vpnPeer?.fromInput).toBeUndefined()
      expect(payload.entities[0]?.exportedInOutputs).toEqual(["vpnPeer"])
      expect(payload.entities[0]?.referencedInOutputs).toEqual(["vpnPeer"])
    },
  )

  projectPortTest(
    "syncs export ports to selected targets and removes stale rows",
    async ({ projectPortService, createProject, database }) => {
      const source = await createProject("source")
      const targetA = await createProject("target-a")
      const targetB = await createProject("target-b")

      const recipientA = await identityToRecipient(await generateIdentity())
      const recipientB = await identityToRecipient(await generateIdentity())

      await database.backend.project.update({
        where: { id: targetA.id },
        data: { publicKey: recipientA },
      })

      await database.backend.project.update({
        where: { id: targetB.id },
        data: { publicKey: recipientB },
      })

      const sourceStateId = "state-sync-1"

      await projectPortService.syncExportPort({
        projectId: source.id,
        sourceStateId,
        targetProjectNames: [targetA.name, targetB.name],
        payload: makePayload("v1"),
      })

      const rowsAfterInitialSync = await database.backend.projectImportPort.findMany({
        where: {
          sourceProjectId: source.id,
          sourceStateId,
        },
        orderBy: { projectId: "asc" },
      })

      expect(rowsAfterInitialSync).toHaveLength(2)
      expect(rowsAfterInitialSync.map(row => row.projectId).sort()).toEqual(
        [targetA.id, targetB.id].sort(),
      )
      expect(rowsAfterInitialSync.every(row => row.contentHash.length === 64)).toBe(true)
      expect(rowsAfterInitialSync.every(row => row.encryptedContent.length > 0)).toBe(true)

      const previousHashForB = rowsAfterInitialSync.find(
        row => row.projectId === targetB.id,
      )?.contentHash

      await projectPortService.syncExportPort({
        projectId: source.id,
        sourceStateId,
        targetProjectNames: [targetB.name],
        payload: makePayload("v2"),
      })

      const rowsAfterResync = await database.backend.projectImportPort.findMany({
        where: {
          sourceProjectId: source.id,
          sourceStateId,
        },
      })

      expect(rowsAfterResync).toHaveLength(1)
      expect(rowsAfterResync[0]?.projectId).toBe(targetB.id)
      expect(rowsAfterResync[0]?.contentHash).not.toBe(previousHashForB)

      await projectPortService.syncExportPort({
        projectId: source.id,
        sourceStateId,
        targetProjectNames: [],
        payload: makePayload("v3"),
      })

      const rowsAfterEmptyTargets = await database.backend.projectImportPort.findMany({
        where: {
          sourceProjectId: source.id,
          sourceStateId,
        },
      })

      expect(rowsAfterEmptyTargets).toHaveLength(0)
    },
  )

  projectPortTest(
    "clears rows for a concrete source state",
    async ({ projectPortService, createProject, database }) => {
      const source = await createProject("source-clear")
      const target = await createProject("target-clear")
      const recipient = await identityToRecipient(await generateIdentity())

      await database.backend.project.update({
        where: { id: target.id },
        data: { publicKey: recipient },
      })

      await projectPortService.syncExportPort({
        projectId: source.id,
        sourceStateId: "state-clear-1",
        targetProjectNames: [target.name],
        payload: makePayload("clear-1"),
      })

      await projectPortService.syncExportPort({
        projectId: source.id,
        sourceStateId: "state-clear-2",
        targetProjectNames: [target.name],
        payload: makePayload("clear-2"),
      })

      await projectPortService.clearExportPort(source.id, "state-clear-1")

      const remaining = await database.backend.projectImportPort.findMany({
        where: {
          sourceProjectId: source.id,
        },
      })

      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.sourceStateId).toBe("state-clear-2")
    },
  )

  projectPortTest(
    "returns numeric import hash and null when row is missing",
    async ({ projectPortService, createProject, database }) => {
      const source = await createProject("source-hash")
      const target = await createProject("target-hash")
      const recipient = await identityToRecipient(await generateIdentity())

      await database.backend.project.update({
        where: { id: target.id },
        data: { publicKey: recipient },
      })

      await projectPortService.syncExportPort({
        projectId: source.id,
        sourceStateId: "state-hash-1",
        targetProjectNames: [target.name],
        payload: makePayload("hash-1"),
      })

      const syncedRow = await database.backend.projectImportPort.findUnique({
        where: {
          projectId_sourceStateId: {
            projectId: target.id,
            sourceStateId: "state-hash-1",
          },
        },
        select: {
          contentHash: true,
        },
      })

      expect(syncedRow).not.toBeNull()

      const numericHash = await projectPortService.getImportPortContentHash(
        target.id,
        "state-hash-1",
      )
      expect(numericHash).toBe(crc32(syncedRow!.contentHash))

      const missingHash = await projectPortService.getImportPortContentHash(
        target.id,
        "state-missing",
      )
      expect(missingHash).toBeNull()
    },
  )

  projectPortTest(
    "stores plain import content when encryption is disabled",
    async ({ createProject, database }) => {
      const projectPortService = new ProjectPortService(database, false)

      const source = await createProject("source-plain")
      const target = await createProject("target-plain")

      await projectPortService.syncExportPort({
        projectId: source.id,
        sourceStateId: "state-plain-1",
        targetProjectNames: [target.name],
        payload: makePayload("plain-1"),
      })

      const row = await database.backend.projectImportPort.findUnique({
        where: {
          projectId_sourceStateId: {
            projectId: target.id,
            sourceStateId: "state-plain-1",
          },
        },
        select: {
          contentHash: true,
          encryptedContent: true,
        },
      })

      expect(row).not.toBeNull()
      expect(row!.encryptedContent.trim().startsWith("{")).toBe(true)
      expect(JSON.parse(row!.encryptedContent)).toEqual(makePayload("plain-1"))
      expect(row!.contentHash).toBe(
        Buffer.from(sha256(Buffer.from(row!.encryptedContent))).toString("hex"),
      )
    },
  )

  projectPortTest(
    "reads import payload and builds captured values for imported entities",
    async ({ createProject, database }) => {
      const projectPortService = new ProjectPortService(database, false)

      const source = await createProject("source-import")
      const target = await createProject("target-import")

      const payload = {
        meta: {
          title: "source-import/port",
          description: "",
          icon: "",
          iconColor: "",
        },
        outputs: {},
        entities: [
          {
            type: "test.entity.v1",
            identity: "user-1",
            referencedInOutputs: ["users"],
            exportedInOutputs: ["users"],
            meta: {
              title: "User 1",
            },
            content: {
              name: "Alice",
            },
          },
        ],
        references: [],
      }

      await projectPortService.syncExportPort({
        projectId: source.id,
        sourceStateId: "state-import-1",
        targetProjectNames: [target.name],
        payload,
      })

      const parsed = await projectPortService.getImportPortPayload(target.id, "state-import-1")
      expect(parsed).not.toBeNull()

      const capturedByOutput = projectPortService.buildImportCapturedOutputValues(parsed!)
      expect(capturedByOutput.users).toHaveLength(1)
      expect(capturedByOutput.users?.[0]).toEqual({
        ok: true,
        value: {
          name: "Alice",
          $meta: {
            type: "test.entity.v1",
            identity: "user-1",
            title: "User 1",
          },
        },
      })

      const snapshotPayload = projectPortService.buildImportEntitySnapshotPayload(parsed!)
      expect(snapshotPayload.nodes).toHaveLength(1)
      expect(snapshotPayload.nodes[0]?.entityId).toBe(
        getEntityId({
          $meta: {
            type: "test.entity.v1",
            identity: "user-1",
          },
        }),
      )
      expect(snapshotPayload.nodes[0]?.entityType).toBe("test.entity.v1")
      expect(snapshotPayload.nodes[0]?.identity).toBe("user-1")
      expect(snapshotPayload.nodes[0]?.exportedOutputs).toEqual(["users"])
      expect(snapshotPayload.nodes[0]?.referencedOutputs).toEqual(["users"])
      expect(snapshotPayload.explicitReferences).toEqual([])
      expect(snapshotPayload.implicitReferences).toEqual([])
    },
  )
})

import type { UnitEntitySnapshotPayload } from "./unit-output"
import { DbNull, type DatabaseManager, type ProjectTransaction } from "../database"
import { createId } from "@paralleldrive/cuid2"
import type { Logger } from "pino"
import type { LibraryModel } from "../shared"
import type { ObjectRefIndexService } from "./object-ref-index"

export type CapturedEntitySnapshotValue = {
  value: Record<string, unknown>
}

export type OutputReferencedEntitySnapshot = {
  snapshotId: string
  entityId: string
  entityType: string
  entityIdentity: string
  content: unknown
}

export class EntitySnapshotService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly objectRefIndexService: ObjectRefIndexService,
    private readonly logger: Logger,
  ) {}

  /**
   * Reconstructs entity values exported by outputs from persisted normalized snapshots.
   *
   * The reconstruction is driven by the entity model inclusions.
   * Reference groups that do not match inclusion field names are ignored.
   * Missing required inclusions will throw.
   *
   * The result is grouped by `${stateId}:${output}`.
   */
  async reconstructLatestExportedOutputValues(
    projectId: string,
    keys: { stateId: string; output: string; operationId?: string }[],
    library: LibraryModel,
  ): Promise<Map<string, CapturedEntitySnapshotValue[]>> {
    if (keys.length === 0) {
      return new Map()
    }

    const uniqueKeys = new Map<string, { stateId: string; output: string; operationId?: string }>()
    for (const key of keys) {
      uniqueKeys.set(`${key.stateId}:${key.output}`, key)
    }

    const projectDatabase = await this.database.forProject(projectId)

    const result = new Map<string, CapturedEntitySnapshotValue[]>()

    for (const key of uniqueKeys.values()) {
      const resolvedOperationId =
        key.operationId ??
        (await this.findLatestOperationIdForExportedOutput(
          projectDatabase,
          key.stateId,
          key.output,
        ))

      if (!resolvedOperationId) {
        result.set(`${key.stateId}:${key.output}`, [])
        continue
      }

      const snapshotsInOperation = await projectDatabase.entitySnapshot.findMany({
        where: { stateId: key.stateId, operationId: resolvedOperationId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          entityId: true,
          content: true,
          meta: true,
          exportedOutputs: true,
          referencedOutputs: true,
          entity: {
            select: {
              type: true,
              identity: true,
            },
          },
        },
      })

      const rootSnapshotIds = snapshotsInOperation
        .filter(s => this.jsonStringArrayIncludes(s.exportedOutputs, key.output))
        .map(s => s.id)

      if (rootSnapshotIds.length === 0) {
        result.set(`${key.stateId}:${key.output}`, [])
        continue
      }

      const { snapshotById, referencesByFromId } = await this.loadSnapshotGraph(
        projectDatabase,
        snapshotsInOperation,
      )

      const reconstructed = rootSnapshotIds.map(rootId => ({
        value: this.reconstructSnapshotValue({
          snapshotId: rootId,
          snapshotById,
          referencesByFromId,
          library,
          stack: [],
        }),
      }))

      result.set(`${key.stateId}:${key.output}`, reconstructed)
    }

    return result
  }

  /**
   * Lists all persisted entity snapshots that belong to the given output in the latest operation.
   *
   * The result includes both the root exported entity snapshot(s) and all snapshots that were
   * referenced from that output (directly or indirectly) during the same operation.
   *
   * This is intended for UI panels that need to inspect referenced entities without reconstructing
   * full exported output values.
   *
   * @param projectId The ID of the project.
   * @param stateId The instance state ID.
   * @param output The output name.
   * @returns A list of snapshots associated with the output.
   */
  async listReferencedEntitySnapshotsForOutput(
    projectId: string,
    stateId: string,
    output: string,
    library?: LibraryModel,
  ): Promise<OutputReferencedEntitySnapshot[]> {
    const projectDatabase = await this.database.forProject(projectId)

    const operationId = await this.findLatestOperationIdForOutput(projectDatabase, stateId, output)

    if (!operationId) {
      return []
    }

    const snapshotsInOperation = await projectDatabase.entitySnapshot.findMany({
      where: { stateId, operationId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        entityId: true,
        content: true,
        meta: true,
        exportedOutputs: true,
        referencedOutputs: true,
        entity: {
          select: {
            type: true,
            identity: true,
          },
        },
      },
    })

    const matching = snapshotsInOperation.filter(
      snapshot =>
        this.jsonStringArrayIncludes(snapshot.exportedOutputs, output) ||
        this.jsonStringArrayIncludes(snapshot.referencedOutputs, output),
    )

    if (!library) {
      return matching.map(snapshot => ({
        snapshotId: snapshot.id,
        entityId: snapshot.entityId,
        entityType: snapshot.entity.type,
        entityIdentity: snapshot.entity.identity,
        content: snapshot.content,
      }))
    }

    const { snapshotById, referencesByFromId } = await this.loadSnapshotGraph(
      projectDatabase,
      snapshotsInOperation,
    )

    return matching.map(snapshot => ({
      snapshotId: snapshot.id,
      entityId: snapshot.entityId,
      entityType: snapshot.entity.type,
      entityIdentity: snapshot.entity.identity,
      content: this.reconstructSnapshotValue({
        snapshotId: snapshot.id,
        snapshotById,
        referencesByFromId,
        library,
        stack: [],
      }),
    }))
  }

  /**
   * Reconstructs a persisted entity snapshot content by following inclusions within the operation.
   *
   * This powers UI views that want to show the same reconstructed shape as exported output popups.
   *
   * @param projectId The ID of the project.
   * @param snapshotId The ID of the snapshot to reconstruct.
   * @param library The loaded library model.
   * @returns The reconstructed snapshot content.
   */
  async reconstructSnapshotContent(
    projectId: string,
    snapshotId: string,
    library: LibraryModel,
  ): Promise<unknown | null> {
    const projectDatabase = await this.database.forProject(projectId)

    const snapshot = await projectDatabase.entitySnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        stateId: true,
        operationId: true,
      },
    })

    if (!snapshot) {
      return null
    }

    const snapshotsInOperation = await projectDatabase.entitySnapshot.findMany({
      where: { stateId: snapshot.stateId, operationId: snapshot.operationId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        entityId: true,
        content: true,
        meta: true,
        exportedOutputs: true,
        referencedOutputs: true,
        entity: {
          select: {
            type: true,
            identity: true,
          },
        },
      },
    })

    const { snapshotById, referencesByFromId } = await this.loadSnapshotGraph(
      projectDatabase,
      snapshotsInOperation,
    )

    return this.reconstructSnapshotValue({
      snapshotId: snapshot.id,
      snapshotById,
      referencesByFromId,
      library,
      stack: [],
    })
  }

  private async findLatestOperationIdForExportedOutput(
    projectDatabase: Awaited<ReturnType<DatabaseManager["forProject"]>>,
    stateId: string,
    output: string,
  ): Promise<string | undefined> {
    const candidates = await projectDatabase.entitySnapshot.findMany({
      where: { stateId },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        operationId: true,
        exportedOutputs: true,
      },
    })

    const match = candidates.find(s => this.jsonStringArrayIncludes(s.exportedOutputs, output))
    return match?.operationId
  }

  private async findLatestOperationIdForOutput(
    projectDatabase: Awaited<ReturnType<DatabaseManager["forProject"]>>,
    stateId: string,
    output: string,
  ): Promise<string | undefined> {
    const candidates = await projectDatabase.entitySnapshot.findMany({
      where: { stateId },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        operationId: true,
        exportedOutputs: true,
        referencedOutputs: true,
      },
    })

    const match = candidates.find(
      s =>
        this.jsonStringArrayIncludes(s.exportedOutputs, output) ||
        this.jsonStringArrayIncludes(s.referencedOutputs, output),
    )

    return match?.operationId
  }

  private jsonStringArrayIncludes(value: unknown, item: string): boolean {
    if (!Array.isArray(value)) {
      return false
    }

    return value.some(x => x === item)
  }

  private async loadSnapshotGraph(
    projectDatabase: Awaited<ReturnType<DatabaseManager["forProject"]>>,
    initialSnapshots: Array<{
      id: string
      entityId: string
      content: unknown
      meta: unknown
      exportedOutputs: unknown
      referencedOutputs: unknown
      entity: { type: string; identity: string }
    }>,
  ): Promise<{
    snapshotById: Map<
      string,
      {
        id: string
        entityId: string
        content: unknown
        meta: unknown
        entity: { type: string; identity: string }
      }
    >
    referencesByFromId: Map<string, Map<string, string[]>>
  }> {
    const snapshotById = new Map<
      string,
      {
        id: string
        entityId: string
        content: unknown
        meta: unknown
        entity: { type: string; identity: string }
      }
    >()

    for (const snapshot of initialSnapshots) {
      snapshotById.set(snapshot.id, {
        id: snapshot.id,
        entityId: snapshot.entityId,
        content: snapshot.content,
        meta: snapshot.meta,
        entity: snapshot.entity,
      })
    }

    const referencesByFromId = new Map<string, Map<string, string[]>>()

    let frontier = Array.from(snapshotById.keys())
    const seen = new Set(frontier)

    const maxSnapshots = 5000

    while (frontier.length > 0) {
      const refs = await projectDatabase.entitySnapshotReference.findMany({
        where: { fromId: { in: frontier } },
        select: { fromId: true, toId: true, group: true },
      })

      const nextToIds: string[] = []

      for (const ref of refs) {
        const groupMap = referencesByFromId.get(ref.fromId) ?? new Map<string, string[]>()
        const list = groupMap.get(ref.group) ?? []
        list.push(ref.toId)
        groupMap.set(ref.group, list)
        referencesByFromId.set(ref.fromId, groupMap)

        if (!seen.has(ref.toId)) {
          nextToIds.push(ref.toId)
        }
      }

      const uniqueNextToIds = Array.from(new Set(nextToIds))
      if (uniqueNextToIds.length === 0) {
        break
      }

      const missing = uniqueNextToIds.filter(id => !snapshotById.has(id))
      if (missing.length > 0) {
        const loaded = await projectDatabase.entitySnapshot.findMany({
          where: { id: { in: missing } },
          select: {
            id: true,
            entityId: true,
            content: true,
            meta: true,
            entity: { select: { type: true, identity: true } },
          },
        })

        for (const snapshot of loaded) {
          snapshotById.set(snapshot.id, {
            id: snapshot.id,
            entityId: snapshot.entityId,
            content: snapshot.content,
            meta: snapshot.meta,
            entity: snapshot.entity,
          })
          seen.add(snapshot.id)
        }

        if (snapshotById.size > maxSnapshots) {
          throw new Error("Entity snapshot graph is too large to reconstruct")
        }
      }

      frontier = uniqueNextToIds
    }

    return { snapshotById, referencesByFromId }
  }

  private reconstructSnapshotValue(options: {
    snapshotId: string
    snapshotById: Map<
      string,
      {
        id: string
        entityId: string
        content: unknown
        meta: unknown
        entity: { type: string; identity: string }
      }
    >
    referencesByFromId: Map<string, Map<string, string[]>>
    library: LibraryModel
    stack: string[]
  }): Record<string, unknown> {
    if (options.stack.includes(options.snapshotId)) {
      throw new Error(
        `Detected entity snapshot cycle during reconstruction: "${options.snapshotId}"`,
      )
    }

    const snapshot = options.snapshotById.get(options.snapshotId)
    if (!snapshot) {
      throw new Error(`Snapshot "${options.snapshotId}" not found during reconstruction`)
    }

    const content = snapshot.content
    if (typeof content !== "object" || content === null || Array.isArray(content)) {
      throw new Error(`Entity snapshot content is not an object for snapshot "${snapshot.id}"`)
    }

    const value: Record<string, unknown> = {
      $meta: {
        type: snapshot.entity.type,
        identity: snapshot.entity.identity,
        snapshotId: snapshot.id,
        ...(this.normalizeSnapshotMeta(snapshot.meta) ?? {}),
      },
      ...(content as Record<string, unknown>),
    }

    const entityModel = options.library.entities[snapshot.entity.type]
    if (!entityModel) {
      throw new Error(`Entity type "${snapshot.entity.type}" is not defined in the library`)
    }

    const refsByGroup = options.referencesByFromId.get(snapshot.id) ?? new Map<string, string[]>()

    for (const inclusion of entityModel.inclusions ?? []) {
      const toIds = refsByGroup.get(inclusion.field) ?? []

      if (inclusion.multiple) {
        if (toIds.length === 0) {
          if (inclusion.required) {
            throw new Error(
              `Missing required inclusion "${inclusion.field}" on entity "${snapshot.entity.type}"`,
            )
          }

          value[inclusion.field] = []
          continue
        }

        value[inclusion.field] = toIds.map(toId =>
          this.reconstructSnapshotValue({
            snapshotId: toId,
            snapshotById: options.snapshotById,
            referencesByFromId: options.referencesByFromId,
            library: options.library,
            stack: [...options.stack, options.snapshotId],
          }),
        )
        continue
      }

      if (toIds.length === 0) {
        if (inclusion.required) {
          throw new Error(
            `Missing required inclusion "${inclusion.field}" on entity "${snapshot.entity.type}"`,
          )
        }

        continue
      }

      if (toIds.length > 1) {
        throw new Error(
          `Multiple references found for single inclusion "${inclusion.field}" on entity "${snapshot.entity.type}"`,
        )
      }

      value[inclusion.field] = this.reconstructSnapshotValue({
        snapshotId: toIds[0]!,
        snapshotById: options.snapshotById,
        referencesByFromId: options.referencesByFromId,
        library: options.library,
        stack: [...options.stack, options.snapshotId],
      })
    }

    return value
  }

  private normalizeSnapshotMeta(meta: unknown): Record<string, unknown> | null {
    if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
      return null
    }

    const record = meta as Record<string, unknown>
    const normalized: Record<string, unknown> = {}

    if (typeof record.title === "string" && record.title.length > 0) {
      normalized.title = record.title
    }
    if (typeof record.description === "string" && record.description.length > 0) {
      normalized.description = record.description
    }
    if (typeof record.icon === "string" && record.icon.length > 0) {
      normalized.icon = record.icon
    }
    if (typeof record.iconColor === "string" && record.iconColor.length > 0) {
      normalized.iconColor = record.iconColor
    }

    return Object.keys(normalized).length > 0 ? normalized : null
  }

  /**
   * Persists all entity snapshots produced by a unit run.
   *
   * It creates or updates the corresponding entity rows,
   * stores immutable snapshots with operation + state provenance,
   * and materializes both implicit and explicit snapshot references.
   *
   * @param options The persistence parameters for a single unit completion.
   */
  async persistUnitEntitySnapshots(options: {
    projectId: string
    operationId: string
    stateId: string
    payload: UnitEntitySnapshotPayload
  }): Promise<void> {
    const projectDatabase = await this.database.forProject(options.projectId)

    const { entityIds, snapshotIds } = await projectDatabase.$transaction(async tx => {
      return await this.persistUnitEntitySnapshotsInTransaction(tx, options)
    })

    const idsToTrack = [...entityIds, ...snapshotIds]
    if (idsToTrack.length > 0) {
      await this.objectRefIndexService.track(options.projectId, idsToTrack)
    }
  }

  private async persistUnitEntitySnapshotsInTransaction(
    tx: ProjectTransaction,
    options: {
      projectId: string
      operationId: string
      stateId: string
      payload: UnitEntitySnapshotPayload
    },
  ): Promise<{ entityIds: string[]; snapshotIds: string[] }> {
    const snapshotIdByEntityId = new Map<string, string>()
    const entityIds = new Set<string>()
    const snapshotIds = new Set<string>()

    for (const node of options.payload.nodes) {
      const snapshotId = createId()
      const entityId = node.entityId
      snapshotIdByEntityId.set(entityId, snapshotId)
      entityIds.add(entityId)
      snapshotIds.add(snapshotId)

      await tx.entity.upsert({
        where: { id: entityId },
        create: {
          id: entityId,
          type: node.entityType,
          identity: node.identity,
        },
        update: {
          type: node.entityType,
          identity: node.identity,
        },
      })

      await tx.entitySnapshot.create({
        data: {
          id: snapshotId,
          entityId,
          operationId: options.operationId,
          stateId: options.stateId,
          referencedOutputs: node.referencedOutputs,
          exportedOutputs: node.exportedOutputs,
          meta: this.normalizeSnapshotMeta(node.meta) ?? DbNull,
          content: node.content,
        },
      })
    }

    const uniqueEdges = new Map<string, { fromId: string; toId: string; group: string }>()

    for (const ref of options.payload.implicitReferences) {
      const fromId = snapshotIdByEntityId.get(ref.fromEntityId)
      const toId = snapshotIdByEntityId.get(ref.toEntityId)
      if (!fromId || !toId) {
        throw new Error("Failed to resolve implicit entity snapshot reference")
      }

      if (fromId === toId) {
        continue
      }

      uniqueEdges.set(`${fromId}:${toId}:${ref.group}`, {
        fromId,
        toId,
        group: ref.group,
      })
    }

    for (const ref of options.payload.explicitReferences) {
      const fromId = snapshotIdByEntityId.get(ref.fromEntityId)
      if (!fromId) {
        throw new Error("Failed to resolve explicit entity snapshot reference source")
      }

      if (ref.fromEntityId === ref.toEntityId) {
        continue
      }

      const toSnapshotInPayload = snapshotIdByEntityId.get(ref.toEntityId)
      if (toSnapshotInPayload) {
        if (fromId !== toSnapshotInPayload) {
          uniqueEdges.set(`${fromId}:${toSnapshotInPayload}:${ref.group}`, {
            fromId,
            toId: toSnapshotInPayload,
            group: ref.group,
          })
        }
        continue
      }

      const snapshot = await tx.entitySnapshot.findFirst({
        where: { entityId: ref.toEntityId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })

      if (!snapshot) {
        this.logger.error(
          {
            projectId: options.projectId,
            operationId: options.operationId,
            entityId: ref.toEntityId,
          },
          "referenced entity not found",
        )
        throw new Error(`Referenced entity "${ref.toEntityId}" does not exist`)
      }

      if (fromId !== snapshot.id) {
        uniqueEdges.set(`${fromId}:${snapshot.id}:${ref.group}`, {
          fromId,
          toId: snapshot.id,
          group: ref.group,
        })
      }
    }

    if (uniqueEdges.size > 0) {
      await tx.entitySnapshotReference.createMany({
        data: Array.from(uniqueEdges.values()),
      })
    }

    return { entityIds: Array.from(entityIds), snapshotIds: Array.from(snapshotIds) }
  }
}

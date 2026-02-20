import type { UnitEntitySnapshotPayload } from "./unit-output"
import type { DatabaseManager, ProjectTransaction } from "../database"
import { getEntityId } from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"
import type { Logger } from "pino"

export type CapturedEntitySnapshotValue = {
  value: Record<string, unknown>
}

export class EntitySnapshotService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly logger: Logger,
  ) {}

  /**
   * Loads the latest entity snapshot values for a set of dependency outputs at a given capture time.
   *
   * The result is grouped by `${stateId}:${output}`.
   */
  async captureLatestSnapshotValues(options: {
    projectId: string
    captureTime: Date
    keys: { stateId: string; output: string }[]
  }): Promise<Map<string, CapturedEntitySnapshotValue[]>> {
    if (options.keys.length === 0) {
      return new Map()
    }

    const uniqueKeys = new Map<string, { stateId: string; output: string }>()
    for (const key of options.keys) {
      uniqueKeys.set(`${key.stateId}:${key.output}`, key)
    }

    const projectDatabase = await this.database.forProject(options.projectId)

    const keyList = Array.from(uniqueKeys.values())
    const stateIds = Array.from(new Set(keyList.map(k => k.stateId)))
    const outputs = Array.from(new Set(keyList.map(k => k.output)))

    const heads = await projectDatabase.entitySnapshot.findMany({
      where: {
        stateId: { in: stateIds },
        output: { in: outputs },
        createdAt: { lte: options.captureTime },
      },
      orderBy: { createdAt: "desc" },
      distinct: ["stateId", "output"],
      select: {
        stateId: true,
        output: true,
        operationId: true,
      },
    })

    if (heads.length === 0) {
      return new Map()
    }

    const snapshots = await projectDatabase.entitySnapshot.findMany({
      where: {
        OR: heads.map(h => ({
          stateId: h.stateId,
          output: h.output,
          operationId: h.operationId,
        })),
      },
      orderBy: { createdAt: "asc" },
      select: {
        stateId: true,
        output: true,
        content: true,
        meta: true,
        entity: {
          select: {
            type: true,
            identity: true,
          },
        },
      },
    })

    const result = new Map<string, CapturedEntitySnapshotValue[]>()

    for (const snapshot of snapshots) {
      const key = `${snapshot.stateId}:${snapshot.output}`
      const content = snapshot.content
      if (typeof content !== "object" || content === null || Array.isArray(content)) {
        this.logger.warn(
          { stateId: snapshot.stateId, output: snapshot.output },
          "entity snapshot content is not an object",
        )
        continue
      }

      const meta = snapshot.meta
      const metaRecord =
        typeof meta === "object" && meta !== null && !Array.isArray(meta)
          ? (meta as Record<string, unknown>)
          : {}

      const value: Record<string, unknown> = {
        $meta: {
          type: snapshot.entity.type,
          ...(snapshot.entity.identity ? { identity: snapshot.entity.identity } : {}),
          ...metaRecord,
        },
        ...(content as Record<string, unknown>),
      }

      const list = result.get(key) ?? []
      list.push({ value })
      result.set(key, list)
    }

    return result
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

    await projectDatabase.$transaction(async tx => {
      await this.persistUnitEntitySnapshotsInTransaction(tx, options)
    })
  }

  private async persistUnitEntitySnapshotsInTransaction(
    tx: ProjectTransaction,
    options: {
      projectId: string
      operationId: string
      stateId: string
      payload: UnitEntitySnapshotPayload
    },
  ): Promise<void> {
    const snapshotIdByNodeId = new Map<string, string>()
    const snapshotIdByEntityId = new Map<string, string>()

    for (const node of options.payload.nodes) {
      const deterministicEntityId = node.identity
        ? getEntityId({
            $meta: {
              type: node.entityType,
              identity: node.identity,
            },
          })
        : undefined

      const snapshotId = createId()
      const entityId = deterministicEntityId ?? snapshotId
      const persistedSnapshotId = deterministicEntityId ? snapshotId : entityId

      snapshotIdByNodeId.set(node.nodeId, persistedSnapshotId)
      snapshotIdByEntityId.set(entityId, persistedSnapshotId)

      await tx.entity.upsert({
        where: { id: entityId },
        create: {
          id: entityId,
          type: node.entityType,
          identity: node.identity ?? null,
        },
        update: {
          type: node.entityType,
          identity: node.identity ?? null,
        },
      })

      await tx.entitySnapshot.create({
        data: {
          id: persistedSnapshotId,
          entityId,
          operationId: options.operationId,
          stateId: options.stateId,
          output: node.output,
          meta: {
            title: node.meta.title ?? node.entityType,
            ...(node.meta.description ? { description: node.meta.description } : {}),
            ...(node.meta.icon ? { icon: node.meta.icon } : {}),
            ...(node.meta.iconColor ? { iconColor: node.meta.iconColor } : {}),
          },
          content: node.content,
        },
      })
    }

    const implicitEdges = options.payload.implicitReferences
      .map(ref => ({
        fromId: snapshotIdByNodeId.get(ref.fromNodeId),
        toId: snapshotIdByNodeId.get(ref.toNodeId),
      }))
      .filter((ref): ref is { fromId: string; toId: string } => Boolean(ref.fromId && ref.toId))
      .filter(ref => ref.fromId !== ref.toId)

    const uniqueImplicitEdges = new Map<string, { fromId: string; toId: string }>()
    for (const edge of implicitEdges) {
      uniqueImplicitEdges.set(`${edge.fromId}:${edge.toId}`, edge)
    }

    if (uniqueImplicitEdges.size > 0) {
      await tx.entitySnapshotReference.createMany({
        data: Array.from(uniqueImplicitEdges.values()),
      })
    }

    const explicitEdges: { fromId: string; toId: string }[] = []

    for (const node of options.payload.nodes) {
      const fromId = snapshotIdByNodeId.get(node.nodeId)
      if (!fromId) {
        continue
      }

      for (const toEntityId of node.explicitReferences) {
        const toSnapshotInPayload = snapshotIdByEntityId.get(toEntityId)
        if (toSnapshotInPayload) {
          if (fromId !== toSnapshotInPayload) {
            explicitEdges.push({ fromId, toId: toSnapshotInPayload })
          }
          continue
        }

        const snapshot = await tx.entitySnapshot.findFirst({
          where: { entityId: toEntityId },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })

        if (!snapshot) {
          this.logger.error(
            {
              projectId: options.projectId,
              operationId: options.operationId,
              entityId: toEntityId,
            },
            "referenced entity not found",
          )
          throw new Error(`Referenced entity "${toEntityId}" does not exist`)
        }

        if (fromId !== snapshot.id) {
          explicitEdges.push({ fromId, toId: snapshot.id })
        }
      }
    }

    const uniqueExplicitEdges = new Map<string, { fromId: string; toId: string }>()
    for (const edge of explicitEdges) {
      uniqueExplicitEdges.set(`${edge.fromId}:${edge.toId}`, edge)
    }

    if (uniqueExplicitEdges.size > 0) {
      await tx.entitySnapshotReference.createMany({
        data: Array.from(uniqueExplicitEdges.values()),
      })
    }
  }
}

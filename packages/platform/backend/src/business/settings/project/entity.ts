import type { ProjectRequestContext } from "../../../common"
import type {
  DatabaseManager,
  EntityOrderByWithRelationInput,
  EntitySnapshotReferenceOrderByWithRelationInput,
  EntitySnapshotReferenceWhereInput,
  EntitySnapshotWhereInput,
  EntityWhereInput,
} from "../../../database"
import type {
  CollectionQuery,
  EntityDetailsOutput,
  EntityOutput,
  EntityQuery,
  EntityReferenceOutput,
  EntitySnapshotDetailsOutput,
  EntitySnapshotListItemOutput,
  PageResult,
} from "../../../shared"
import { z } from "zod"
import {
  buildProjectAuthorizationWhere,
  queryDatabasePage,
  requireProjectPermission,
} from "../../../common"
import {
  collectionQuerySchema,
  entityDetailsOutputSchema,
  entityOutputSchema,
  entityQuerySchema,
  entityReferenceOutputSchema,
  entitySnapshotDetailsOutputSchema,
  entitySnapshotListItemOutputSchema,
  toCommonEntityMeta,
} from "../../../shared"
import { querySettingsPage } from "../shared"

export class EntitySettingsService {
  constructor(private readonly database: DatabaseManager) {}

  private static buildEntityWhere(query: EntityQuery): EntityWhereInput {
    const where: EntityWhereInput = {}

    if (query.type) {
      where.type = { contains: query.type }
    }

    if (!query.search) {
      return where
    }

    return {
      ...where,
      OR: [
        { id: { contains: query.search } },
        { type: { contains: query.search } },
        { identity: { contains: query.search } },
      ],
    }
  }

  private static buildEntityOrderBy(query: EntityQuery) {
    const defaultOrderBy: EntityOrderByWithRelationInput[] = [{ type: "asc" }, { identity: "asc" }]

    const sort = query.sortBy?.[0] ?? null
    if (!sort) {
      return defaultOrderBy
    }

    if (sort.key === "type") {
      return [{ type: sort.order }]
    }

    if (sort.key === "identity") {
      return [{ identity: sort.order }]
    }

    return defaultOrderBy
  }

  private static isCreatedAtEntitySort(query: EntityQuery): query is EntityQuery & {
    sortBy: [{ key: "createdAt"; order: "asc" | "desc" }]
  } {
    if (query.sortBy?.length !== 1) {
      return false
    }

    const [sort] = query.sortBy
    if (!sort) {
      return false
    }

    return sort.key === "createdAt"
  }

  private static buildEntitySnapshotWhere(
    query: CollectionQuery,
    snapshotIdField: "fromId" | "toId",
    snapshotId: string,
  ) {
    const baseWhere = { [snapshotIdField]: snapshotId } as EntitySnapshotReferenceWhereInput

    if (!query.search) {
      return baseWhere
    }

    return {
      AND: [
        baseWhere,
        {
          OR: [
            { group: { contains: query.search } },
            { [snapshotIdField]: { contains: query.search } },
          ],
        },
      ],
    }
  }

  private static buildEntitySnapshotOrderBy(
    query: CollectionQuery,
  ): EntitySnapshotReferenceOrderByWithRelationInput[] {
    const defaultOrderBy: EntitySnapshotReferenceOrderByWithRelationInput[] = [
      { group: "asc" },
      { kind: "asc" },
    ]

    const sort = query.sortBy?.[0] ?? null
    if (!sort) {
      return defaultOrderBy
    }

    if (sort.key === "group") {
      return [{ group: sort.order }, { kind: "asc" }]
    }

    return defaultOrderBy
  }

  async queryEntities(
    context: ProjectRequestContext,
    query: EntityQuery,
  ): Promise<PageResult<EntityOutput>> {
    const parsedQuery = entityQuerySchema.parse(query)
    const db = await this.database.forProject(context.projectId)
    const whereClause = EntitySettingsService.buildEntityWhere(parsedQuery)

    const authorization = await buildProjectAuthorizationWhere<EntityWhereInput>({
      database: this.database,
      context,
      permission: "entity.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        instances: scope => ({ snapshots: { some: { stateId: { in: [...scope.stateIds] } } } }),
      },
    })

    const select = {
      id: true,
      type: true,
      identity: true,
      snapshots: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          content: {
            select: {
              meta: true,
            },
          },
          createdAt: true,
        },
      },
    } as const

    const orderQuery = EntitySettingsService.isCreatedAtEntitySort(parsedQuery)
      ? { ...parsedQuery, sortBy: undefined }
      : parsedQuery

    return await querySettingsPage({
      collection: "entities",
      request: parsedQuery,
      query: { projectId: context.projectId, ...parsedQuery },
      fetch: async ({ cursorId, take }) =>
        await db.entity.findMany({
          where: { AND: [whereClause, authorization] },
          orderBy: [...EntitySettingsService.buildEntityOrderBy(orderQuery), { id: "asc" }],
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          select,
        }),
      map: item => {
        const lastSnapshot = item.snapshots[0] ?? null
        const meta = toCommonEntityMeta(lastSnapshot?.content.meta)

        return entityOutputSchema.parse({
          id: item.id,
          type: item.type,
          identity: item.identity,
          meta: meta.title ? meta : { ...meta, title: item.identity },
          snapshotId: lastSnapshot?.id,
          createdAt: lastSnapshot?.createdAt,
        })
      },
    })
  }

  async getEntityDetails(
    context: ProjectRequestContext,
    entityId: string,
  ): Promise<EntityDetailsOutput | null> {
    const db = await this.database.forProject(context.projectId)

    const entity = await db.entity.findUnique({
      where: { id: entityId },
      select: {
        id: true,
        type: true,
        identity: true,
        snapshots: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            content: {
              select: {
                meta: true,
                content: true,
              },
            },
            operationId: true,
            stateId: true,
            referencedInOutputs: true,
            exportedInOutputs: true,
            createdAt: true,
          },
        },
      },
    })

    if (!entity) {
      return null
    }

    requireProjectPermission(context, "entity.get", { resourceId: entity.id })

    const lastSnapshot = entity.snapshots[0] ?? null
    const meta = toCommonEntityMeta(lastSnapshot?.content.meta)

    return entityDetailsOutputSchema.parse({
      id: entity.id,
      type: entity.type,
      identity: entity.identity,
      meta: meta.title ? meta : { ...meta, title: entity.identity },
      createdAt: lastSnapshot?.createdAt,
      lastSnapshot: lastSnapshot
        ? {
            id: lastSnapshot.id,
            meta: toCommonEntityMeta(lastSnapshot.content.meta),
            content: lastSnapshot.content.content,
            operationId: lastSnapshot.operationId,
            stateId: lastSnapshot.stateId,
            referencedInOutputs: z.string().array().parse(lastSnapshot.referencedInOutputs),
            exportedInOutputs: z.string().array().parse(lastSnapshot.exportedInOutputs),
            createdAt: lastSnapshot.createdAt,
          }
        : null,
    })
  }

  async getEntitySnapshotDetails(
    context: ProjectRequestContext,
    snapshotId: string,
  ): Promise<EntitySnapshotDetailsOutput | null> {
    const db = await this.database.forProject(context.projectId)

    const snapshot = await db.entitySnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        content: {
          select: {
            meta: true,
            content: true,
          },
        },
        operationId: true,
        stateId: true,
        referencedInOutputs: true,
        exportedInOutputs: true,
        createdAt: true,
        entity: {
          select: {
            id: true,
            type: true,
            identity: true,
          },
        },
      },
    })

    if (!snapshot) {
      return null
    }

    requireProjectPermission(context, "entity-snapshot.get", { resourceId: snapshot.id })

    const meta = toCommonEntityMeta(snapshot.content.meta)

    return entitySnapshotDetailsOutputSchema.parse({
      entity: {
        id: snapshot.entity.id,
        type: snapshot.entity.type,
        identity: snapshot.entity.identity,
      },
      snapshot: {
        id: snapshot.id,
        meta: meta.title ? meta : { ...meta, title: snapshot.entity.identity },
        content: snapshot.content.content,
        operationId: snapshot.operationId,
        stateId: snapshot.stateId,
        referencedInOutputs: z.string().array().parse(snapshot.referencedInOutputs),
        exportedInOutputs: z.string().array().parse(snapshot.exportedInOutputs),
        createdAt: snapshot.createdAt,
      },
    })
  }

  async queryEntitySnapshotsForEntity(
    context: ProjectRequestContext,
    entityId: string,
    query: CollectionQuery,
    excludeSnapshotId?: string,
  ): Promise<PageResult<EntitySnapshotListItemOutput>> {
    const parsedQuery = collectionQuerySchema.parse(query)
    const db = await this.database.forProject(context.projectId)
    const authorization = await buildProjectAuthorizationWhere<EntitySnapshotWhereInput>({
      database: this.database,
      context,
      permission: "entity-snapshot.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        instances: scope => ({ stateId: { in: [...scope.stateIds] } }),
      },
    })

    const whereClause = {
      entityId,
      ...(excludeSnapshotId ? { NOT: { id: excludeSnapshotId } } : {}),
      ...(parsedQuery.search
        ? {
            OR: [
              { id: { contains: parsedQuery.search } },
              { operationId: { contains: parsedQuery.search } },
              { stateId: { contains: parsedQuery.search } },
            ],
          }
        : {}),
    }

    return await querySettingsPage({
      collection: "entity-snapshots",
      request: parsedQuery,
      query: { projectId: context.projectId, entityId, excludeSnapshotId, ...parsedQuery },
      fetch: async ({ cursorId, take }) =>
        await db.entitySnapshot.findMany({
          where: { AND: [whereClause, authorization] },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          select: {
            id: true,
            content: {
              select: {
                meta: true,
              },
            },
            operationId: true,
            stateId: true,
            createdAt: true,
            entity: {
              select: {
                type: true,
                identity: true,
              },
            },
          },
        }),
      map: item => {
        const meta = toCommonEntityMeta(item.content.meta)

        return entitySnapshotListItemOutputSchema.parse({
          id: item.id,
          entityType: item.entity.type,
          meta: meta.title ? meta : { ...meta, title: item.entity.identity },
          operationId: item.operationId,
          stateId: item.stateId,
          createdAt: item.createdAt,
        })
      },
    })
  }

  async queryEntitySnapshotsForInstanceOperation(
    context: ProjectRequestContext,
    stateId: string,
    operationId: string,
    query: CollectionQuery,
  ): Promise<PageResult<EntitySnapshotListItemOutput>> {
    const parsedQuery = collectionQuerySchema.parse(query)
    const db = await this.database.forProject(context.projectId)
    const authorization = await buildProjectAuthorizationWhere<EntitySnapshotWhereInput>({
      database: this.database,
      context,
      permission: "entity-snapshot.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        instances: scope => ({ stateId: { in: [...scope.stateIds] } }),
      },
    })

    const whereClause = {
      stateId,
      operationId,
      ...(parsedQuery.search
        ? {
            OR: [
              { id: { contains: parsedQuery.search } },
              { entityId: { contains: parsedQuery.search } },
              { entity: { identity: { contains: parsedQuery.search } } },
              { entity: { type: { contains: parsedQuery.search } } },
            ],
          }
        : {}),
    }

    return await querySettingsPage({
      collection: "instance-operation-entity-snapshots",
      request: parsedQuery,
      query: { projectId: context.projectId, stateId, operationId, ...parsedQuery },
      fetch: async ({ cursorId, take }) =>
        await db.entitySnapshot.findMany({
          where: { AND: [whereClause, authorization] },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          select: {
            id: true,
            content: {
              select: {
                meta: true,
              },
            },
            operationId: true,
            stateId: true,
            createdAt: true,
            entity: {
              select: {
                type: true,
                identity: true,
              },
            },
          },
        }),
      map: item => {
        const meta = toCommonEntityMeta(item.content.meta)

        return entitySnapshotListItemOutputSchema.parse({
          id: item.id,
          entityType: item.entity.type,
          meta: meta.title ? meta : { ...meta, title: item.entity.identity },
          operationId: item.operationId,
          stateId: item.stateId,
          createdAt: item.createdAt,
        })
      },
    })
  }

  async queryEntitySnapshotOutgoingReferences(
    context: ProjectRequestContext,
    snapshotId: string,
    query: CollectionQuery,
  ): Promise<PageResult<EntityReferenceOutput>> {
    const db = await this.database.forProject(context.projectId)

    const snapshot = await db.entitySnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        content: {
          select: {
            meta: true,
          },
        },
        entity: {
          select: {
            id: true,
            type: true,
            identity: true,
          },
        },
      },
    })

    if (!snapshot) {
      return { items: [] }
    }

    requireProjectPermission(context, "entity-snapshot.get", { resourceId: snapshot.id })

    const whereClause = EntitySettingsService.buildEntitySnapshotWhere(query, "fromId", snapshot.id)

    const fromMeta = toCommonEntityMeta(snapshot.content.meta)

    return await queryDatabasePage({
      collection: "entity-snapshot-outgoing-references",
      request: query,
      query: { projectId: context.projectId, snapshotId, ...query },
      cursorSchema: referenceCursorSchema,
      fetch: async ({ cursor, take }) =>
        await db.entitySnapshotReference.findMany({
          where: whereClause,
          orderBy: [
            ...EntitySettingsService.buildEntitySnapshotOrderBy(query),
            { fromId: "asc" },
            { toId: "asc" },
          ],
          cursor: cursor ? { fromId_toId_kind_group: cursor } : undefined,
          skip: cursor ? 1 : 0,
          take,
          select: {
            kind: true,
            group: true,
            fromId: true,
            toId: true,
            to: {
              select: {
                id: true,
                content: {
                  select: {
                    meta: true,
                  },
                },
                entity: {
                  select: {
                    id: true,
                    type: true,
                    identity: true,
                  },
                },
              },
            },
          },
        }),
      cursor: item => ({
        fromId: item.fromId,
        toId: item.toId,
        kind: item.kind,
        group: item.group,
      }),
      map: item => {
        const toEntity = item.to.entity
        const toMeta = toCommonEntityMeta(item.to.content.meta)

        return entityReferenceOutputSchema.parse({
          id: `${item.fromId}:${item.toId}:${item.kind}:${item.group}`,
          meta: toMeta.title ? toMeta : { ...toMeta, title: toEntity.identity },
          group: item.group,

          fromSnapshotId: item.fromId,
          fromEntityId: snapshot.entity.id,
          fromEntityType: snapshot.entity.type,
          fromEntityIdentity: snapshot.entity.identity,
          fromEntityMeta: fromMeta.title
            ? fromMeta
            : { ...fromMeta, title: snapshot.entity.identity },

          toSnapshotId: item.toId,
          toEntityId: toEntity.id,
          toEntityType: toEntity.type,
          toEntityIdentity: toEntity.identity,
          toEntityMeta: toMeta.title ? toMeta : { ...toMeta, title: toEntity.identity },
        })
      },
    })
  }

  async queryEntitySnapshotIncomingReferences(
    context: ProjectRequestContext,
    snapshotId: string,
    query: CollectionQuery,
  ): Promise<PageResult<EntityReferenceOutput>> {
    const db = await this.database.forProject(context.projectId)

    const snapshot = await db.entitySnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        content: {
          select: {
            meta: true,
          },
        },
        entity: {
          select: {
            id: true,
            type: true,
            identity: true,
          },
        },
      },
    })

    if (!snapshot) {
      return { items: [] }
    }

    requireProjectPermission(context, "entity-snapshot.get", { resourceId: snapshot.id })

    const whereClause = EntitySettingsService.buildEntitySnapshotWhere(query, "toId", snapshot.id)

    const toMeta = toCommonEntityMeta(snapshot.content.meta)

    return await queryDatabasePage({
      collection: "entity-snapshot-incoming-references",
      request: query,
      query: { projectId: context.projectId, snapshotId, ...query },
      cursorSchema: referenceCursorSchema,
      fetch: async ({ cursor, take }) =>
        await db.entitySnapshotReference.findMany({
          where: whereClause,
          orderBy: [
            ...EntitySettingsService.buildEntitySnapshotOrderBy(query),
            { fromId: "asc" },
            { toId: "asc" },
          ],
          cursor: cursor ? { fromId_toId_kind_group: cursor } : undefined,
          skip: cursor ? 1 : 0,
          take,
          select: {
            kind: true,
            group: true,
            fromId: true,
            toId: true,
            from: {
              select: {
                id: true,
                content: {
                  select: {
                    meta: true,
                  },
                },
                entity: {
                  select: {
                    id: true,
                    type: true,
                    identity: true,
                  },
                },
              },
            },
          },
        }),
      cursor: item => ({
        fromId: item.fromId,
        toId: item.toId,
        kind: item.kind,
        group: item.group,
      }),
      map: item => {
        const fromEntity = item.from.entity
        const fromMeta = toCommonEntityMeta(item.from.content.meta)

        return entityReferenceOutputSchema.parse({
          id: `${item.fromId}:${item.toId}:${item.kind}:${item.group}`,
          meta: fromMeta.title ? fromMeta : { ...fromMeta, title: fromEntity.identity },
          group: item.group,

          fromSnapshotId: item.fromId,
          fromEntityId: fromEntity.id,
          fromEntityType: fromEntity.type,
          fromEntityIdentity: fromEntity.identity,
          fromEntityMeta: fromMeta.title ? fromMeta : { ...fromMeta, title: fromEntity.identity },

          toSnapshotId: item.toId,
          toEntityId: snapshot.entity.id,
          toEntityType: snapshot.entity.type,
          toEntityIdentity: snapshot.entity.identity,
          toEntityMeta: toMeta.title ? toMeta : { ...toMeta, title: snapshot.entity.identity },
        })
      },
    })
  }

  async queryEntityOutgoingReferences(
    context: ProjectRequestContext,
    entityId: string,
    query: CollectionQuery,
  ): Promise<PageResult<EntityReferenceOutput>> {
    const db = await this.database.forProject(context.projectId)

    const entity = await db.entity.findUnique({
      where: { id: entityId },
      select: {
        id: true,
        type: true,
        identity: true,
        snapshots: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            content: {
              select: {
                meta: true,
              },
            },
          },
        },
      },
    })

    if (!entity) {
      return { items: [] }
    }

    requireProjectPermission(context, "entity.get", { resourceId: entity.id })

    const lastSnapshot = entity.snapshots[0] ?? null
    if (!lastSnapshot) {
      return { items: [] }
    }

    const whereClause = EntitySettingsService.buildEntitySnapshotWhere(
      query,
      "fromId",
      lastSnapshot.id,
    )

    const fromMeta = toCommonEntityMeta(lastSnapshot.content.meta)

    return await queryDatabasePage({
      collection: "entity-outgoing-references",
      request: query,
      query: { projectId: context.projectId, entityId, ...query },
      cursorSchema: referenceCursorSchema,
      fetch: async ({ cursor, take }) =>
        await db.entitySnapshotReference.findMany({
          where: whereClause,
          orderBy: [
            ...EntitySettingsService.buildEntitySnapshotOrderBy(query),
            { fromId: "asc" },
            { toId: "asc" },
          ],
          cursor: cursor ? { fromId_toId_kind_group: cursor } : undefined,
          skip: cursor ? 1 : 0,
          take,
          select: {
            kind: true,
            group: true,
            fromId: true,
            toId: true,
            to: {
              select: {
                id: true,
                content: {
                  select: {
                    meta: true,
                  },
                },
                entity: {
                  select: {
                    id: true,
                    type: true,
                    identity: true,
                  },
                },
              },
            },
          },
        }),
      cursor: item => ({
        fromId: item.fromId,
        toId: item.toId,
        kind: item.kind,
        group: item.group,
      }),
      map: item => {
        const toEntity = item.to.entity
        const toMeta = toCommonEntityMeta(item.to.content.meta)

        return entityReferenceOutputSchema.parse({
          id: `${item.fromId}:${item.toId}:${item.kind}:${item.group}`,
          meta: toMeta.title ? toMeta : { ...toMeta, title: toEntity.identity },
          group: item.group,

          fromSnapshotId: item.fromId,
          fromEntityId: entity.id,
          fromEntityType: entity.type,
          fromEntityIdentity: entity.identity,
          fromEntityMeta: fromMeta.title ? fromMeta : { ...fromMeta, title: entity.identity },

          toSnapshotId: item.toId,
          toEntityId: toEntity.id,
          toEntityType: toEntity.type,
          toEntityIdentity: toEntity.identity,
          toEntityMeta: toMeta.title ? toMeta : { ...toMeta, title: toEntity.identity },
        })
      },
    })
  }

  async queryEntityIncomingReferences(
    context: ProjectRequestContext,
    entityId: string,
    query: CollectionQuery,
  ): Promise<PageResult<EntityReferenceOutput>> {
    const db = await this.database.forProject(context.projectId)

    const entity = await db.entity.findUnique({
      where: { id: entityId },
      select: {
        id: true,
        type: true,
        identity: true,
        snapshots: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            content: {
              select: {
                meta: true,
              },
            },
          },
        },
      },
    })

    if (!entity) {
      return { items: [] }
    }

    requireProjectPermission(context, "entity.get", { resourceId: entity.id })

    const lastSnapshot = entity.snapshots[0] ?? null
    if (!lastSnapshot) {
      return { items: [] }
    }

    const whereClause = EntitySettingsService.buildEntitySnapshotWhere(
      query,
      "toId",
      lastSnapshot.id,
    )

    const toMeta = toCommonEntityMeta(lastSnapshot.content.meta)

    return await queryDatabasePage({
      collection: "entity-incoming-references",
      request: query,
      query: { projectId: context.projectId, entityId, ...query },
      cursorSchema: referenceCursorSchema,
      fetch: async ({ cursor, take }) =>
        await db.entitySnapshotReference.findMany({
          where: whereClause,
          orderBy: [
            ...EntitySettingsService.buildEntitySnapshotOrderBy(query),
            { fromId: "asc" },
            { toId: "asc" },
          ],
          cursor: cursor ? { fromId_toId_kind_group: cursor } : undefined,
          skip: cursor ? 1 : 0,
          take,
          select: {
            kind: true,
            group: true,
            fromId: true,
            toId: true,
            from: {
              select: {
                id: true,
                content: {
                  select: {
                    meta: true,
                  },
                },
                entity: {
                  select: {
                    id: true,
                    type: true,
                    identity: true,
                  },
                },
              },
            },
          },
        }),
      cursor: item => ({
        fromId: item.fromId,
        toId: item.toId,
        kind: item.kind,
        group: item.group,
      }),
      map: item => {
        const fromEntity = item.from.entity
        const fromMeta = toCommonEntityMeta(item.from.content.meta)

        return entityReferenceOutputSchema.parse({
          id: `${item.fromId}:${item.toId}:${item.kind}:${item.group}`,
          meta: fromMeta.title ? fromMeta : { ...fromMeta, title: fromEntity.identity },
          group: item.group,

          fromSnapshotId: item.fromId,
          fromEntityId: fromEntity.id,
          fromEntityType: fromEntity.type,
          fromEntityIdentity: fromEntity.identity,
          fromEntityMeta: fromMeta.title ? fromMeta : { ...fromMeta, title: fromEntity.identity },

          toSnapshotId: item.toId,
          toEntityId: entity.id,
          toEntityType: entity.type,
          toEntityIdentity: entity.identity,
          toEntityMeta: toMeta.title ? toMeta : { ...toMeta, title: entity.identity },
        })
      },
    })
  }
}

const referenceCursorSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  kind: z.enum(["explicit", "inclusion"]),
  group: z.string(),
})

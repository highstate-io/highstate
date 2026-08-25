import { collectionQuerySchema, entityQuerySchema } from "@highstate/backend/shared"
import { z } from "zod"
import { projectProcedure, router } from "../../../trpc"
import { projectInput } from "../shared"

const entityInput = projectInput.extend({ entityId: z.string() })
const snapshotInput = projectInput.extend({ snapshotId: z.cuid2() })

export const entitySettingsRouter = router({
  query: projectProcedure
    .input(projectInput.extend({ query: entityQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.entitySettingsService.queryEntities(ctx.requestContext, input.query)
    }),

  get: projectProcedure.input(entityInput).query(async ({ ctx, input }) => {
    return await ctx.entitySettingsService.getEntityDetails(ctx.requestContext, input.entityId)
  }),

  getSnapshot: projectProcedure.input(snapshotInput).query(async ({ ctx, input }) => {
    const details = await ctx.entitySettingsService.getEntitySnapshotDetails(
      ctx.requestContext,
      input.snapshotId,
    )
    if (!details) return null
    const project = await ctx.projectService.getProjectOrThrowCore(input.projectId)
    const library = await ctx.libraryBackend.loadLibrary(project.libraryId)
    try {
      const content = await ctx.entitySnapshotService.reconstructSnapshotContent(
        ctx.requestContext,
        input.snapshotId,
        library,
      )
      return { ...details, snapshot: { ...details.snapshot, content } }
    } catch {
      return details
    }
  }),

  querySnapshots: projectProcedure
    .input(
      entityInput.extend({ excludeSnapshotId: z.cuid2().optional(), query: collectionQuerySchema }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.entitySettingsService.queryEntitySnapshotsForEntity(
        ctx.requestContext,
        input.entityId,
        input.query,
        input.excludeSnapshotId,
      )
    }),

  querySnapshotsForInstanceOperation: projectProcedure
    .input(
      projectInput.extend({
        stateId: z.cuid2(),
        operationId: z.cuid2(),
        query: collectionQuerySchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.entitySettingsService.queryEntitySnapshotsForInstanceOperation(
        ctx.requestContext,
        input.stateId,
        input.operationId,
        input.query,
      )
    }),

  queryOutgoingReferences: projectProcedure
    .input(entityInput.extend({ query: collectionQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.entitySettingsService.queryEntityOutgoingReferences(
        ctx.requestContext,
        input.entityId,
        input.query,
      )
    }),

  querySnapshotOutgoingReferences: projectProcedure
    .input(snapshotInput.extend({ query: collectionQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.entitySettingsService.queryEntitySnapshotOutgoingReferences(
        ctx.requestContext,
        input.snapshotId,
        input.query,
      )
    }),

  queryIncomingReferences: projectProcedure
    .input(entityInput.extend({ query: collectionQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.entitySettingsService.queryEntityIncomingReferences(
        ctx.requestContext,
        input.entityId,
        input.query,
      )
    }),

  querySnapshotIncomingReferences: projectProcedure
    .input(snapshotInput.extend({ query: collectionQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.entitySettingsService.queryEntitySnapshotIncomingReferences(
        ctx.requestContext,
        input.snapshotId,
        input.query,
      )
    }),
})

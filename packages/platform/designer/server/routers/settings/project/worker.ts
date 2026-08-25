import { collectionQuerySchema, workerQuerySchema } from "@highstate/backend/shared"
import { z } from "zod"
import { projectProcedure, router } from "../../../trpc"
import { projectInput } from "../shared"

const workerInput = projectInput.extend({ workerId: z.cuid2() })
const versionInput = projectInput.extend({ versionId: z.cuid2() })

export const workerSettingsRouter = router({
  query: projectProcedure
    .input(projectInput.extend({ query: workerQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.workerSettingsService.query(ctx.requestContext, input.query)
    }),

  get: projectProcedure.input(workerInput).query(async ({ ctx, input }) => {
    return await ctx.workerSettingsService.get(ctx.requestContext, input.workerId)
  }),

  queryVersions: projectProcedure
    .input(workerInput.extend({ query: collectionQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.workerSettingsService.queryVersions(
        ctx.requestContext,
        input.workerId,
        input.query,
      )
    }),

  getVersion: projectProcedure.input(versionInput).query(async ({ ctx, input }) => {
    return await ctx.workerSettingsService.getVersion(ctx.requestContext, input.versionId)
  }),
})

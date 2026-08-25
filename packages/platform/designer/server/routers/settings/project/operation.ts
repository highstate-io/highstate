import { collectionQuerySchema } from "@highstate/backend/shared"
import { z } from "zod"
import { projectProcedure, router } from "../../../trpc"
import { projectInput } from "../shared"

const operationInput = projectInput.extend({ operationId: z.cuid2() })

export const operationSettingsRouter = router({
  query: projectProcedure
    .input(projectInput.extend({ query: collectionQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.operationSettingsService.query(ctx.requestContext, input.query)
    }),

  get: projectProcedure.input(operationInput).query(async ({ ctx, input }) => {
    return await ctx.operationSettingsService.get(ctx.requestContext, input.operationId)
  }),
})

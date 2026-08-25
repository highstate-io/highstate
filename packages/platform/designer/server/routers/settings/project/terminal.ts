import { collectionQuerySchema, terminalQuerySchema } from "@highstate/backend/shared"
import { z } from "zod"
import { projectProcedure, router } from "../../../trpc"
import { projectInput } from "../shared"

const terminalInput = projectInput.extend({ terminalId: z.cuid2() })

export const terminalSettingsRouter = router({
  query: projectProcedure
    .input(projectInput.extend({ query: terminalQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.terminalSettingsService.query(ctx.requestContext, input.query)
    }),

  get: projectProcedure.input(terminalInput).query(async ({ ctx, input }) => {
    return await ctx.terminalSettingsService.get(ctx.requestContext, input.terminalId)
  }),

  querySessions: projectProcedure
    .input(terminalInput.extend({ query: collectionQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.terminalSettingsService.querySessions(
        ctx.requestContext,
        input.terminalId,
        input.query,
      )
    }),
})

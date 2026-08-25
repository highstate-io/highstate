import { triggerQuerySchema } from "@highstate/backend/shared"
import { z } from "zod"
import { projectProcedure, router } from "../../../trpc"
import { projectInput } from "../shared"

const triggerInput = projectInput.extend({ triggerId: z.cuid2() })

export const triggerSettingsRouter = router({
  query: projectProcedure
    .input(projectInput.extend({ query: triggerQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.triggerSettingsService.query(ctx.requestContext, input.query)
    }),

  get: projectProcedure.input(triggerInput).query(async ({ ctx, input }) => {
    return await ctx.triggerSettingsService.get(ctx.requestContext, input.triggerId)
  }),
})

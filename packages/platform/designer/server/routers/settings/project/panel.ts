import { panelQuerySchema } from "@highstate/backend/shared"
import { z } from "zod"
import { projectProcedure, router } from "../../../trpc"
import { projectInput } from "../shared"

const panelInput = projectInput.extend({ panelId: z.cuid2() })

export const panelSettingsRouter = router({
  query: projectProcedure
    .input(projectInput.extend({ query: panelQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.panelSettingsService.query(ctx.requestContext, input.query)
    }),

  get: projectProcedure.input(panelInput).query(async ({ ctx, input }) => {
    return await ctx.panelSettingsService.get(ctx.requestContext, input.panelId)
  }),
})

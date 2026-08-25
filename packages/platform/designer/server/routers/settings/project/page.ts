import { pageQuerySchema } from "@highstate/backend/shared"
import { z } from "zod"
import { projectProcedure, router } from "../../../trpc"

const pageInput = z.object({ pageId: z.cuid2() })

export const pageSettingsRouter = router({
  query: projectProcedure
    .input(z.object({ query: pageQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.pageSettingsService.query(ctx.requestContext, input.query)
    }),

  get: projectProcedure.input(pageInput).query(async ({ ctx, input }) => {
    return await ctx.pageSettingsService.get(ctx.requestContext, input.pageId)
  }),
})

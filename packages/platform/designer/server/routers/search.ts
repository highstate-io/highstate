import { z } from "zod"
import { publicProcedure, router } from "../trpc"

export const searchRouter = router({
  searchByIds: publicProcedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1).max(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.globalSearchService.searchByIds(input.ids)
    }),
})

import { secretQuerySchema } from "@highstate/backend/shared"
import { z } from "zod"
import { projectProcedure, router } from "../../../trpc"
import { projectInput } from "../shared"

const secretInput = projectInput.extend({ secretId: z.cuid2() })

export const secretSettingsRouter = router({
  query: projectProcedure
    .input(projectInput.extend({ query: secretQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.secretSettingsService.query(ctx.requestContext, input.query)
    }),

  get: projectProcedure.input(secretInput).query(async ({ ctx, input }) => {
    return await ctx.secretSettingsService.get(ctx.requestContext, input.secretId)
  }),

  getValue: projectProcedure.input(secretInput).query(async ({ ctx, input }) => {
    return await ctx.secretSettingsService.getValue(ctx.requestContext, input.secretId)
  }),
})

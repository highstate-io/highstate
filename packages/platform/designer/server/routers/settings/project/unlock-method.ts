import { collectionQuerySchema, unlockMethodInputSchema } from "@highstate/backend/shared"
import { z } from "zod"
import { projectProcedure, router } from "../../../trpc"
import { projectInput } from "../shared"

const unlockMethodInput = projectInput.extend({ unlockMethodId: z.cuid2() })

export const unlockMethodSettingsRouter = router({
  query: projectProcedure
    .input(projectInput.extend({ query: collectionQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.unlockMethodSettingsService.query(ctx.requestContext, input.query)
    }),

  get: projectProcedure.input(unlockMethodInput).query(async ({ ctx, input }) => {
    return await ctx.unlockMethodSettingsService.get(ctx.requestContext, input.unlockMethodId)
  }),

  create: projectProcedure
    .input(projectInput.extend({ unlockMethod: unlockMethodInputSchema }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.unlockMethodSettingsService.create(ctx.requestContext, input.unlockMethod)
    }),

  delete: projectProcedure.input(unlockMethodInput).mutation(async ({ ctx, input }) => {
    return await ctx.unlockMethodSettingsService.delete(ctx.requestContext, input.unlockMethodId)
  }),
})

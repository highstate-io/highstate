import { backendApiKeyInputSchema, backendApiKeyQuerySchema } from "@highstate/backend/shared"
import { z } from "zod"
import { backendProcedure, router } from "../../../trpc"

const apiKeyInput = z.object({ apiKeyId: z.cuid2() })

export const backendApiKeySettingsRouter = router({
  query: backendProcedure.input(backendApiKeyQuerySchema).query(async ({ ctx, input }) => {
    return await ctx.backendApiKeySettingsService.query(ctx.requestContext, input)
  }),

  get: backendProcedure.input(apiKeyInput).query(async ({ ctx, input }) => {
    return await ctx.backendApiKeySettingsService.get(ctx.requestContext, input.apiKeyId)
  }),

  create: backendProcedure.input(backendApiKeyInputSchema).mutation(async ({ ctx, input }) => {
    return await ctx.backendApiKeySettingsService.create(ctx.requestContext, input)
  }),

  update: backendProcedure
    .input(apiKeyInput.extend({ apiKey: backendApiKeyInputSchema }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.backendApiKeySettingsService.update(
        ctx.requestContext,
        input.apiKeyId,
        input.apiKey,
      )
    }),

  delete: backendProcedure.input(apiKeyInput).mutation(async ({ ctx, input }) => {
    return await ctx.backendApiKeySettingsService.delete(ctx.requestContext, input.apiKeyId)
  }),

  getServiceAccountOptions: backendProcedure.query(async ({ ctx }) => {
    return await ctx.backendApiKeySettingsService.getServiceAccountOptions(ctx.requestContext)
  }),
})

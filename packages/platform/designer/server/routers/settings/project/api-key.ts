import { apiKeyInputSchema, apiKeyQuerySchema } from "@highstate/backend/shared"
import { projectProcedure, router } from "../../../trpc"
import { apiKeyInput, projectInput } from "../shared"

export const projectApiKeySettingsRouter = router({
  query: projectProcedure
    .input(projectInput.extend({ query: apiKeyQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.projectApiKeySettingsService.query(ctx.requestContext, input.query)
    }),

  get: projectProcedure.input(apiKeyInput).query(async ({ ctx, input }) => {
    return await ctx.projectApiKeySettingsService.get(ctx.requestContext, input.apiKeyId)
  }),

  create: projectProcedure
    .input(projectInput.extend({ apiKey: apiKeyInputSchema }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.projectApiKeySettingsService.create(ctx.requestContext, input.apiKey)
    }),

  update: projectProcedure
    .input(apiKeyInput.extend({ apiKey: apiKeyInputSchema }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.projectApiKeySettingsService.update(
        ctx.requestContext,
        input.apiKeyId,
        input.apiKey,
      )
    }),

  delete: projectProcedure.input(apiKeyInput).mutation(async ({ ctx, input }) => {
    return await ctx.projectApiKeySettingsService.delete(ctx.requestContext, input.apiKeyId)
  }),

  getServiceAccountOptions: projectProcedure.input(projectInput).query(async ({ ctx }) => {
    return await ctx.projectApiKeySettingsService.getServiceAccountOptions(ctx.requestContext)
  }),
})

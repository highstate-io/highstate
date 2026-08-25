import { z } from "zod"
import { backendProcedure, projectProcedure, router } from "../trpc"

export const apiKeyRouter = router({
  rotateBackend: backendProcedure
    .input(z.object({ apiKeyId: z.cuid2() }))
    .mutation(
      async ({ ctx, input }) =>
        await ctx.apiKeyService.rotateBackendApiKey(ctx.requestContext, input.apiKeyId),
    ),
  rotateProject: projectProcedure
    .input(z.object({ apiKeyId: z.cuid2() }))
    .mutation(
      async ({ ctx, input }) =>
        await ctx.apiKeyService.rotateProjectApiKey(ctx.requestContext, input.apiKeyId),
    ),
})

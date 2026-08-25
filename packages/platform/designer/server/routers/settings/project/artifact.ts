import { artifactQuerySchema } from "@highstate/backend/shared"
import { z } from "zod"
import { projectProcedure, router } from "../../../trpc"
import { projectInput } from "../shared"

const artifactInput = projectInput.extend({ artifactId: z.cuid2() })

export const artifactSettingsRouter = router({
  query: projectProcedure
    .input(projectInput.extend({ query: artifactQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.artifactSettingsService.query(ctx.requestContext, input.query)
    }),

  get: projectProcedure.input(artifactInput).query(async ({ ctx, input }) => {
    return await ctx.artifactSettingsService.get(ctx.requestContext, input.artifactId)
  }),
})

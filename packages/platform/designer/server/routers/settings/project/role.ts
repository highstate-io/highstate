import { projectRoleInputSchema, projectRoleQuerySchema } from "@highstate/backend/shared"
import { projectProcedure, router } from "../../../trpc"
import { projectInput, roleInput } from "../shared"

export const projectRoleSettingsRouter = router({
  query: projectProcedure
    .input(projectInput.extend({ query: projectRoleQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.projectRoleSettingsService.query(ctx.requestContext, input.query)
    }),

  get: projectProcedure.input(roleInput).query(async ({ ctx, input }) => {
    return await ctx.projectRoleSettingsService.get(ctx.requestContext, input.roleId)
  }),

  create: projectProcedure
    .input(projectInput.extend({ role: projectRoleInputSchema }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.projectRoleSettingsService.create(ctx.requestContext, input.role)
    }),

  update: projectProcedure
    .input(roleInput.extend({ role: projectRoleInputSchema }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.projectRoleSettingsService.update(
        ctx.requestContext,
        input.roleId,
        input.role,
      )
    }),

  delete: projectProcedure.input(roleInput).mutation(async ({ ctx, input }) => {
    return await ctx.projectRoleSettingsService.delete(ctx.requestContext, input.roleId)
  }),

  getRestrictionOptions: projectProcedure.input(projectInput).query(async ({ ctx }) => {
    return await ctx.projectRoleSettingsService.getRestrictionOptions(ctx.requestContext)
  }),
})

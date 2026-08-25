import { serviceAccountInputSchema, serviceAccountQuerySchema } from "@highstate/backend/shared"
import { projectProcedure, router } from "../../../trpc"
import { projectInput, roleBindingInput, roleInput, serviceAccountInput } from "../shared"

export const projectServiceAccountSettingsRouter = router({
  query: projectProcedure
    .input(projectInput.extend({ query: serviceAccountQuerySchema }))
    .query(async ({ ctx, input }) => {
      return await ctx.projectServiceAccountSettingsService.query(ctx.requestContext, input.query)
    }),

  get: projectProcedure.input(serviceAccountInput).query(async ({ ctx, input }) => {
    return await ctx.projectServiceAccountSettingsService.get(
      ctx.requestContext,
      input.serviceAccountId,
    )
  }),

  create: projectProcedure
    .input(projectInput.extend({ serviceAccount: serviceAccountInputSchema }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.projectServiceAccountSettingsService.create(
        ctx.requestContext,
        input.serviceAccount,
      )
    }),

  update: projectProcedure
    .input(serviceAccountInput.extend({ serviceAccount: serviceAccountInputSchema }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.projectServiceAccountSettingsService.update(
        ctx.requestContext,
        input.serviceAccountId,
        input.serviceAccount,
      )
    }),

  delete: projectProcedure.input(serviceAccountInput).mutation(async ({ ctx, input }) => {
    return await ctx.projectServiceAccountSettingsService.delete(
      ctx.requestContext,
      input.serviceAccountId,
    )
  }),

  getRoleBindings: projectProcedure.input(serviceAccountInput).query(async ({ ctx, input }) => {
    return await ctx.projectServiceAccountSettingsService.getRoleBindings(
      ctx.requestContext,
      input.serviceAccountId,
    )
  }),

  getRoleBindingsByRole: projectProcedure.input(roleInput).query(async ({ ctx, input }) => {
    return await ctx.projectServiceAccountSettingsService.getRoleBindingsByRole(
      ctx.requestContext,
      input.roleId,
    )
  }),

  addRoleBinding: projectProcedure.input(roleBindingInput).mutation(async ({ ctx, input }) => {
    return await ctx.projectServiceAccountSettingsService.addRoleBinding(
      ctx.requestContext,
      input.roleId,
      input.serviceAccountId,
    )
  }),

  removeRoleBinding: projectProcedure.input(roleBindingInput).mutation(async ({ ctx, input }) => {
    return await ctx.projectServiceAccountSettingsService.removeRoleBinding(
      ctx.requestContext,
      input.roleId,
      input.serviceAccountId,
    )
  }),
})

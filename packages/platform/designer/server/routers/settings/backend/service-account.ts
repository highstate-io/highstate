import {
  backendServiceAccountInputSchema,
  backendServiceAccountQuerySchema,
} from "@highstate/backend/shared"
import { z } from "zod"
import { backendProcedure, router } from "../../../trpc"

const roleInput = z.object({ roleId: z.cuid2() })
const serviceAccountInput = z.object({ serviceAccountId: z.cuid2() })
const bindingInput = roleInput.extend(serviceAccountInput.shape)

export const backendServiceAccountSettingsRouter = router({
  query: backendProcedure.input(backendServiceAccountQuerySchema).query(async ({ ctx, input }) => {
    return await ctx.backendServiceAccountSettingsService.query(ctx.requestContext, input)
  }),

  get: backendProcedure.input(serviceAccountInput).query(async ({ ctx, input }) => {
    return await ctx.backendServiceAccountSettingsService.get(
      ctx.requestContext,
      input.serviceAccountId,
    )
  }),

  create: backendProcedure
    .input(backendServiceAccountInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.backendServiceAccountSettingsService.create(ctx.requestContext, input)
    }),

  update: backendProcedure
    .input(serviceAccountInput.extend({ serviceAccount: backendServiceAccountInputSchema }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.backendServiceAccountSettingsService.update(
        ctx.requestContext,
        input.serviceAccountId,
        input.serviceAccount,
      )
    }),

  delete: backendProcedure.input(serviceAccountInput).mutation(async ({ ctx, input }) => {
    return await ctx.backendServiceAccountSettingsService.delete(
      ctx.requestContext,
      input.serviceAccountId,
    )
  }),

  getRoleBindings: backendProcedure.input(serviceAccountInput).query(async ({ ctx, input }) => {
    return await ctx.backendServiceAccountSettingsService.getRoleBindings(
      ctx.requestContext,
      input.serviceAccountId,
    )
  }),

  getRoleBindingsByRole: backendProcedure.input(roleInput).query(async ({ ctx, input }) => {
    return await ctx.backendServiceAccountSettingsService.getRoleBindingsByRole(
      ctx.requestContext,
      input.roleId,
    )
  }),

  addRoleBinding: backendProcedure.input(bindingInput).mutation(async ({ ctx, input }) => {
    return await ctx.backendServiceAccountSettingsService.addRoleBinding(
      ctx.requestContext,
      input.roleId,
      input.serviceAccountId,
    )
  }),

  removeRoleBinding: backendProcedure.input(bindingInput).mutation(async ({ ctx, input }) => {
    return await ctx.backendServiceAccountSettingsService.removeRoleBinding(
      ctx.requestContext,
      input.roleId,
      input.serviceAccountId,
    )
  }),

  getProjectBindingOptions: backendProcedure
    .input(serviceAccountInput)
    .query(async ({ ctx, input }) => {
      return await ctx.backendServiceAccountSettingsService.getProjectBindingOptions(
        ctx.requestContext,
        input.serviceAccountId,
      )
    }),

  setProjectBinding: backendProcedure
    .input(
      serviceAccountInput.extend({
        projectId: z.cuid2(),
        projectServiceAccountId: z.cuid2().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return await ctx.backendServiceAccountSettingsService.setProjectBinding(
        ctx.requestContext,
        input.serviceAccountId,
        input.projectId,
        input.projectServiceAccountId,
      )
    }),
})

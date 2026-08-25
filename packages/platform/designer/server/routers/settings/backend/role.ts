import { backendRoleInputSchema, backendRoleQuerySchema } from "@highstate/backend/shared"
import { z } from "zod"
import { backendProcedure, router } from "../../../trpc"

const roleInput = z.object({ roleId: z.cuid2() })

export const backendRoleSettingsRouter = router({
  query: backendProcedure.input(backendRoleQuerySchema).query(async ({ ctx, input }) => {
    return await ctx.backendRoleSettingsService.query(ctx.requestContext, input)
  }),

  get: backendProcedure.input(roleInput).query(async ({ ctx, input }) => {
    return await ctx.backendRoleSettingsService.get(ctx.requestContext, input.roleId)
  }),

  create: backendProcedure.input(backendRoleInputSchema).mutation(async ({ ctx, input }) => {
    return await ctx.backendRoleSettingsService.create(ctx.requestContext, input)
  }),

  update: backendProcedure
    .input(roleInput.extend({ role: backendRoleInputSchema }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.backendRoleSettingsService.update(
        ctx.requestContext,
        input.roleId,
        input.role,
      )
    }),

  delete: backendProcedure.input(roleInput).mutation(async ({ ctx, input }) => {
    return await ctx.backendRoleSettingsService.delete(ctx.requestContext, input.roleId)
  }),

  getRestrictionOptions: backendProcedure.query(async ({ ctx }) => {
    return await ctx.backendRoleSettingsService.getRestrictionOptions(ctx.requestContext)
  }),
})

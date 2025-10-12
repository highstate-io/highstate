import { z } from "zod"
import { publicProcedure, router } from "../trpc"
import { operationLaunchInputSchema, operationPlanInputSchema } from "@highstate/backend/shared"
import { instanceIdSchema } from "@highstate/contract"

export const operationRouter = router({
  getLastOperations: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const database = await ctx.database.forProject(input.projectId)

      return await database.operation.findMany({
        orderBy: { startedAt: "desc" },
        take: 20,
      })
    }),

  launch: publicProcedure.input(operationLaunchInputSchema).mutation(async ({ input, ctx }) => {
    return await ctx.operationManager.launch(input)
  }),

  plan: publicProcedure.input(operationPlanInputSchema).mutation(async ({ input, ctx }) => {
    return await ctx.operationManager.plan(input)
  }),

  watch: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .subscription(({ input, ctx, signal }) => {
      return ctx.pubsubManager.subscribe(["operation", input.projectId], signal)
    }),

  cancel: publicProcedure
    .input(
      z.object({
        operationId: z.string(),
      }),
    )
    .mutation(({ input, ctx }) => {
      ctx.operationManager.cancel(input.operationId)
    }),

  cancelInstance: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        operationId: z.string(),
        instanceId: instanceIdSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      ctx.operationManager.cancelInstance(input.operationId, input.instanceId)
    }),
})

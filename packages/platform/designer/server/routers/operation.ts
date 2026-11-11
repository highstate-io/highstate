import { operationLaunchInputSchema, operationPlanInputSchema } from "@highstate/backend/shared"
import { instanceIdSchema } from "@highstate/contract"
import { z } from "zod"
import { projectProcedure, router } from "../trpc"

export const operationRouter = router({
  getLastOperations: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .query(async ({ ctx }) => {
      const page = await ctx.operationService.getOperations(ctx.requestContext, { pageSize: 20 })
      return page.items
    }),

  launch: projectProcedure.input(operationLaunchInputSchema).mutation(async ({ input, ctx }) => {
    return await ctx.operationManager.launchAuthorized(ctx.requestContext, input)
  }),

  plan: projectProcedure.input(operationPlanInputSchema).mutation(async ({ input, ctx }) => {
    return await ctx.operationManager.planAuthorized(ctx.requestContext, input)
  }),

  watch: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .subscription(async ({ input, ctx, signal }) => {
      const visible = await ctx.operationService.getVisibleOperationIds(ctx.requestContext)
      const events = await ctx.pubsubManager.subscribe(["operation", input.projectId], signal)
      return (async function* () {
        for await (const event of events) {
          if (event.type === "deleted") {
            if (visible.delete(event.operationId)) {
              yield event
            }

            continue
          }

          const current = await ctx.operationService.getVisibleOperationIds(ctx.requestContext)
          if (current.has(event.operation.id)) {
            visible.add(event.operation.id)
            yield event
          }
        }
      })()
    }),

  cancel: projectProcedure
    .input(
      z.object({
        operationId: z.string(),
        projectId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.operationService.authorizeCancellation(ctx.requestContext, input.operationId)
      ctx.operationManager.cancel(input.operationId)
    }),

  cancelInstance: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        operationId: z.string(),
        instanceId: instanceIdSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.operationService.authorizeCancellation(
        ctx.requestContext,
        input.operationId,
        input.instanceId,
      )

      ctx.operationManager.cancelInstance(input.operationId, input.instanceId)
    }),
})

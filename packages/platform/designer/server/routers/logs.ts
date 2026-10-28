import { z } from "zod"
import { projectProcedure, router } from "../trpc"

export const logsRouter = router({
  getInstanceLogs: projectProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        operationId: z.cuid2(),
        stateId: z.cuid2(),
        pageSize: z.number().int().nonnegative().optional(),
        pageToken: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.operationService.getOperationLogs(
        ctx.requestContext,
        input.operationId,
        input.stateId,
        input,
      )
    }),

  watchInstanceLogs: projectProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        operationId: z.cuid2(),
        stateId: z.cuid2(),
      }),
    )
    .subscription(async ({ input, ctx, signal }) => {
      const authorize = async () =>
        await ctx.operationService.authorizeLogAccess(
          ctx.requestContext,
          input.operationId,
          input.stateId,
        )

      await authorize()
      ctx.revalidate.push(authorize)
      return await ctx.pubsubManager.subscribe(
        ["operation-instance-log", input.operationId, input.stateId],
        signal,
      )
    }),

  getWorkerVersionLogs: projectProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        workerVersionId: z.cuid2(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.workerService.getWorkerVersionLogs(ctx.requestContext, input.workerVersionId)
    }),

  watchWorkerVersionLogs: projectProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        workerVersionId: z.cuid2(),
      }),
    )
    .subscription(async ({ input, ctx, signal }) => {
      const authorize = async () =>
        await ctx.workerService.authorizeVersion(
          ctx.requestContext,
          input.workerVersionId,
          "worker-version.get",
        )

      await authorize()
      ctx.revalidate.push(authorize)
      return await ctx.pubsubManager.subscribe(
        ["worker-version-log", input.projectId, input.workerVersionId],
        signal,
      )
    }),
})

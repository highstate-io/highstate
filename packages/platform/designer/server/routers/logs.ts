import { z } from "zod"
import { projectProcedure, publicProcedure, router } from "../trpc"

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

  watchInstanceLogs: publicProcedure
    .input(
      z.object({
        operationId: z.cuid2(),
        stateId: z.cuid2(),
      }),
    )
    .subscription(async ({ input, ctx, signal }) => {
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

  watchWorkerVersionLogs: publicProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        workerVersionId: z.cuid2(),
      }),
    )
    .subscription(async ({ input, ctx, signal }) => {
      return await ctx.pubsubManager.subscribe(
        ["worker-version-log", input.projectId, input.workerVersionId],
        signal,
      )
    }),
})

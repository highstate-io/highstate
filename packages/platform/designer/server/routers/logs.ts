import { z } from "zod"
import { publicProcedure, router } from "../trpc"

export const logsRouter = router({
  getInstanceLogs: publicProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        operationId: z.cuid2(),
        stateId: z.cuid2(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.operationService.getOperationLogs(
        input.projectId,
        input.operationId,
        input.stateId,
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

  getWorkerVersionLogs: publicProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        workerVersionId: z.cuid2(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.workerService.getWorkerVersionLogs(input.projectId, input.workerVersionId)
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

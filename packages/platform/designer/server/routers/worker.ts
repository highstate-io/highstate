import { z } from "zod"
import { publicProcedure, router } from "../trpc"

export const workerRouter = router({
  restartVersion: publicProcedure
    .input(z.object({ projectId: z.cuid2(), workerVersionId: z.cuid2() }))
    .mutation(
      async ({ ctx, input }) =>
        await ctx.workerManager.restartWorkerVersion(input.projectId, input.workerVersionId),
    ),
  watchVersionStatuses: publicProcedure
    .input(z.object({ projectId: z.cuid2() }))
    .subscription(({ ctx, input, signal }) =>
      ctx.pubsubManager.subscribe(["worker-version-status", input.projectId], signal),
    ),
})

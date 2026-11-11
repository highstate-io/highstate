import { z } from "zod"
import { projectProcedure, router } from "../trpc"

export const workerRouter = router({
  restartVersion: projectProcedure
    .input(z.object({ projectId: z.cuid2(), workerVersionId: z.cuid2() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.workerService.authorizeVersion(
        ctx.requestContext,
        input.workerVersionId,
        "worker-version.restart",
      )

      await ctx.workerManager.restartWorkerVersion(input.projectId, input.workerVersionId)
    }),
  watchVersionStatuses: projectProcedure
    .input(z.object({ projectId: z.cuid2() }))
    .subscription(async ({ ctx, input, signal }) => {
      await ctx.workerService.getVisibleVersionIds(ctx.requestContext)

      const events = await ctx.pubsubManager.subscribe(
        ["worker-version-status", input.projectId],
        signal,
      )

      return (async function* () {
        for await (const event of events) {
          const visible = await ctx.workerService.getVisibleVersionIds(ctx.requestContext)
          if (visible.has(event.workerVersionId)) {
            yield event
          }
        }
      })()
    }),
})

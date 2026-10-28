import { requireBackendPermission } from "@highstate/backend"
import { z } from "zod"
import { backendProcedure, projectProcedure, router } from "../trpc"

const libraryProcedure = backendProcedure
  .input(z.object({ libraryId: z.string() }))
  .use(async ({ ctx, input, next }) => {
    requireBackendPermission(ctx.requestContext, "library.get", { resourceId: input.libraryId })
    return await next()
  })

export const libraryRouter = router({
  get: libraryProcedure.input(z.object({ libraryId: z.string() })).query(async ({ ctx, input }) => {
    return await ctx.libraryBackend.loadLibrary(input.libraryId)
  }),

  getProjectVirtualComponents: projectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, signal }) => {
      return await ctx.libraryService.getVirtualComponents(ctx.requestContext, signal)
    }),

  watch: libraryProcedure.input(z.object({ libraryId: z.string() })).subscription(async function* ({
    ctx,
    input,
    signal,
  }) {
    yield* ctx.libraryBackend.watchLibrary(input.libraryId, signal)
  }),

  getUnitSourceHashes: libraryProcedure
    .input(z.object({ libraryId: z.string(), unitTypes: z.string().array() }))
    .query(async ({ ctx, input }) => {
      const resolvedSources = await ctx.libraryBackend.getResolvedUnitSources(
        input.libraryId,
        input.unitTypes,
      )

      return resolvedSources.map(({ unitType, sourceHash }) => ({ unitType, sourceHash }))
    }),

  watchUnitSourceHashes: libraryProcedure
    .input(z.object({ libraryId: z.string() }))
    .subscription(async function* ({ ctx, input, signal }) {
      for await (const resolvedSource of ctx.libraryBackend.watchResolvedUnitSources(
        input.libraryId,
        signal,
      )) {
        yield { unitType: resolvedSource.unitType, sourceHash: resolvedSource.sourceHash }
      }
    }),
})

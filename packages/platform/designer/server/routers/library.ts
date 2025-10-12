import { z } from "zod"
import { publicProcedure, router } from "../trpc"

export const libraryRouter = router({
  get: publicProcedure.input(z.object({ libraryId: z.string() })).query(async ({ ctx, input }) => {
    return await ctx.libraryBackend.loadLibrary(input.libraryId)
  }),
  watch: publicProcedure.input(z.object({ libraryId: z.string() })).subscription(async function* ({
    ctx,
    input,
    signal,
  }) {
    yield* ctx.libraryBackend.watchLibrary(input.libraryId, signal)
  }),
  getUnitSourceHashes: publicProcedure
    .input(z.object({ libraryId: z.string(), unitTypes: z.string().array() }))
    .query(async ({ ctx, input }) => {
      const resolvedSources = await ctx.libraryBackend.getResolvedUnitSources(
        input.libraryId,
        input.unitTypes,
      )

      return resolvedSources.map(({ unitType, sourceHash }) => ({ unitType, sourceHash }))
    }),
  watchUnitSourceHashes: publicProcedure
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

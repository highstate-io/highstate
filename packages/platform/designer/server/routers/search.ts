import { z } from "zod"
import { publicProcedure, router } from "../trpc"

export const searchRouter = router({
  searchByIds: publicProcedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1).max(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.globalSearchService.searchByIds(input.ids)
    }),

  searchByText: publicProcedure
    .input(
      z.object({
        text: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const tokens = input.text.trim().split(/\s+/).filter(Boolean)

      if (tokens.length === 0) {
        return { text: input.text, projects: [] }
      }

      if (tokens.length === 1) {
        const firstToken = tokens[0]
        if (!firstToken) {
          return { text: input.text, projects: [] }
        }

        return await ctx.globalSearchService.searchByText(firstToken)
      }

      const limitedTokens = tokens.slice(0, 5)
      const results = await Promise.all(
        limitedTokens.map(async token => {
          return await ctx.globalSearchService.searchByText(token)
        }),
      )

      const projectIds = results
        .map(r => new Set(r.projects.map(p => p.projectId)))
        .reduce((acc, set) => {
          if (!acc) {
            return set
          }

          const intersection = new Set<string>()
          for (const projectId of acc) {
            if (set.has(projectId)) {
              intersection.add(projectId)
            }
          }

          return intersection
        }, null as Set<string> | null)

      if (!projectIds || projectIds.size === 0) {
        return { text: input.text, projects: [] }
      }

      const projects = Array.from(projectIds)
        .map(projectId => {
          const projectResults = results.map(r => r.projects.find(p => p.projectId === projectId))
          const allHaveProject = projectResults.every(p => !!p)

          if (!allHaveProject) {
            return null
          }

          const firstHits = projectResults[0]!.hits
          const otherHitKeySets = projectResults
            .slice(1)
            .map(p => new Set(p!.hits.map(h => `${h.kind}:${h.id}`)))

          const commonHits = firstHits.filter(hit => {
            const key = `${hit.kind}:${hit.id}`
            return otherHitKeySets.every(set => set.has(key))
          })

          if (commonHits.length === 0) {
            return null
          }

          return {
            projectId,
            hits: commonHits,
          }
        })
        .filter(
          (project) =>project !== null
        )

      return {
        text: input.text,
        projects,
      }
    }),
})

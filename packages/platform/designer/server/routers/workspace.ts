import { z } from "zod"
import { backendProcedure, projectProcedure, router } from "../trpc"

export const workspaceRouter = router({
  getWorkspaceLayout: backendProcedure.query(async ({ ctx }) => {
    const userId = ctx.requestContext.subject.userId
    const workspaceLayout = await ctx.database.backend.userWorkspaceLayout.findUnique({
      where: { userId },
    })

    return workspaceLayout?.layout
  }),

  setWorkspaceLayout: backendProcedure
    .input(
      z.object({
        layout: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.requestContext.subject.userId
      await ctx.database.backend.userWorkspaceLayout.upsert({
        where: { userId },
        create: { userId, layout: input.layout },
        update: { layout: input.layout },
      })
    }),

  getProjectViewport: projectProcedure.query(async ({ ctx }) => {
    const database = await ctx.database.forProject(ctx.requestContext.projectId)
    const userId = ctx.requestContext.subject.userId

    const viewport = await database.userProjectViewport.findUnique({
      where: { userId },
    })

    return viewport?.viewport
  }),

  setProjectViewport: projectProcedure
    .input(
      z.object({
        viewport: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.database.forProject(ctx.requestContext.projectId)
      const userId = ctx.requestContext.subject.userId

      await database.userProjectViewport.upsert({
        where: { userId },
        create: { userId, viewport: input.viewport },
        update: { viewport: input.viewport },
      })
    }),

  getCompositeViewport: projectProcedure
    .input(
      z.object({
        stateId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const database = await ctx.database.forProject(ctx.requestContext.projectId)
      const userId = ctx.requestContext.subject.userId

      const viewport = await database.userCompositeViewport.findUnique({
        where: { userId_stateId: { userId, stateId: input.stateId } },
      })

      return viewport?.viewport
    }),

  setCompositeViewport: projectProcedure
    .input(
      z.object({
        stateId: z.string(),
        viewport: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.database.forProject(ctx.requestContext.projectId)
      const userId = ctx.requestContext.subject.userId

      await database.userCompositeViewport.upsert({
        where: { userId_stateId: { userId, stateId: input.stateId } },
        create: {
          userId,
          stateId: input.stateId,
          viewport: input.viewport,
        },
        update: { viewport: input.viewport },
      })
    }),
})

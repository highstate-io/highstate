import { z } from "zod"
import { authenticatedProcedure, router } from "../trpc"

export const workspaceRouter = router({
  getWorkspaceLayout: authenticatedProcedure.query(async ({ ctx }) => {
    const workspaceLayout = await ctx.database.backend.userWorkspaceLayout.findUnique({
      where: { userId: ctx.userId },
    })

    return workspaceLayout?.layout
  }),

  setWorkspaceLayout: authenticatedProcedure
    .input(
      z.object({
        layout: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.database.backend.userWorkspaceLayout.upsert({
        where: { userId: ctx.userId },
        create: { userId: ctx.userId, layout: input.layout },
        update: { layout: input.layout },
      })
    }),

  getProjectViewport: authenticatedProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const database = await ctx.database.forProject(input.projectId)

      const viewport = await database.userProjectViewport.findUnique({
        where: { userId: ctx.userId },
      })

      return viewport?.viewport
    }),

  setProjectViewport: authenticatedProcedure
    .input(
      z.object({
        projectId: z.string(),
        viewport: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.database.forProject(input.projectId)

      await database.userProjectViewport.upsert({
        where: { userId: ctx.userId },
        create: { userId: ctx.userId, viewport: input.viewport },
        update: { viewport: input.viewport },
      })
    }),

  getCompositeViewport: authenticatedProcedure
    .input(
      z.object({
        projectId: z.string(),
        stateId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const database = await ctx.database.forProject(input.projectId)

      const viewport = await database.userCompositeViewport.findFirst({
        where: { stateId: input.stateId },
      })

      return viewport?.viewport
    }),

  setCompositeViewport: authenticatedProcedure
    .input(
      z.object({
        projectId: z.string(),
        stateId: z.string(),
        viewport: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.database.forProject(input.projectId)

      await database.userCompositeViewport.upsert({
        where: { userId_stateId: { userId: ctx.userId, stateId: input.stateId } },
        create: {
          userId: ctx.userId,
          stateId: input.stateId,
          viewport: input.viewport,
        },
        update: { viewport: input.viewport },
      })
    }),
})

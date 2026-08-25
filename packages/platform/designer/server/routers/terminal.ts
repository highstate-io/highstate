import { z } from "zod"
import { projectProcedure, publicProcedure, router } from "../trpc"

export const terminalRouter = router({
  getOrCreateTerminalSession: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        terminalId: z.string(),
        newSession: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const session = await ctx.terminalManager.getOrCreateSession(
        input.projectId,
        input.terminalId,
        input.newSession,
      )

      return session
    }),

  getTerminals: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        terminalIds: z.array(z.string()),
      }),
    )
    .query(async ({ input, ctx }) => {
      const database = await ctx.database.forProject(input.projectId)

      return await database.terminal.findMany({
        where: { id: { in: input.terminalIds } },
      })
    }),

  getTerminalSession: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        sessionId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.terminalSessionService.getTerminalSession(
        ctx.requestContext,
        input.sessionId,
      )
    }),

  getInstanceTerminalSessions: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        stateId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.terminalSessionService.getInstanceTerminalSessions(
        ctx.requestContext,
        input.stateId,
      )
    }),

  watchSession: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        sessionId: z.string(),
      }),
    )
    .subscription(({ input, ctx, signal }) => {
      return ctx.terminalManager.watchSession(input.projectId, input.sessionId, signal)
    }),

  getSessionHistory: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        sessionId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.terminalSessionService.getSessionHistory(ctx.requestContext, input.sessionId)
    }),
})

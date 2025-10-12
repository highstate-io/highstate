import { z } from "zod"
import { publicProcedure, router } from "../trpc"

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

  getTerminalSession: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        sessionId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.terminalSessionService.getTerminalSession(input.projectId, input.sessionId)
    }),

  getInstanceTerminalSessions: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        stateId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.terminalSessionService.getInstanceTerminalSessions(
        input.projectId,
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

  getSessionHistory: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        sessionId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.terminalSessionService.getSessionHistory(input.projectId, input.sessionId)
    }),
})

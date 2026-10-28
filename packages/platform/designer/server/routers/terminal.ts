import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { projectProcedure, router } from "../trpc"

export const terminalRouter = router({
  getOrCreateTerminalSession: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        terminalId: z.string(),
        newSession: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.terminalSessionService.authorizeConnection(ctx.requestContext, input.terminalId)

      const session = await ctx.terminalManager.getOrCreateSession(
        input.projectId,
        input.terminalId,
        input.newSession,
      )

      return session
    }),

  getTerminals: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        terminalIds: z.array(z.string()),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.terminalSessionService.getTerminals(ctx.requestContext, input.terminalIds)
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

  watchSession: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        sessionId: z.string(),
      }),
    )
    .subscription(async ({ input, ctx, signal }) => {
      const authorize = async () => {
        const session = await ctx.terminalSessionService.getTerminalSession(
          ctx.requestContext,
          input.sessionId,
        )

        if (!session) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }
      }

      await authorize()
      ctx.revalidate.push(authorize)
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

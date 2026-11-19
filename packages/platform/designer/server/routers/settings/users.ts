import type {
  BackendRequestContext,
  DesignerIdentity,
  ProjectRequestContext,
  Services,
} from "@highstate/backend"
import { setTimeout as delay } from "node:timers/promises"
import { resolveHumanBackendContext, resolveHumanProjectContext } from "@highstate/backend"
import { collectionQuerySchema } from "@highstate/backend/shared"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { backendProcedure, projectProcedure, router } from "../../trpc"
import { isHostedAuth } from "../../utils/auth-config"
import { authenticateHostedSession } from "../../utils/hosted-session"
import { projectInput } from "./shared"

const userInput = z.object({ userId: z.cuid2() })
const watchInput = z.object({ userId: z.cuid2().optional(), bindings: z.boolean().optional() })

async function* watchUsers(
  ctx: Services & {
    requestContext: BackendRequestContext | ProjectRequestContext
    identity: DesignerIdentity
    designerSessionToken?: string
  },
  userId: string | undefined,
  bindings: boolean | undefined,
  signal: AbortSignal | undefined,
) {
  let previous: string | undefined

  while (!signal?.aborted) {
    const hosted = isHostedAuth()

    const identity = hosted
      ? await authenticateHostedSession(ctx, ctx.designerSessionToken).catch(() => {
          throw new TRPCError({ code: "UNAUTHORIZED" })
        })
      : ctx.identity

    const context =
      ctx.requestContext.realm === "backend"
        ? await resolveHumanBackendContext(ctx.database, identity, !hosted)
        : await resolveHumanProjectContext(
            ctx.database,
            identity,
            ctx.requestContext.projectId,
            !hosted,
          )

    const revision = await ctx.userSettingsService.getRevision(context, userId, bindings ?? false)
    if (revision !== previous) {
      previous = revision
      yield revision
    }

    try {
      await delay(1000, undefined, { signal })
    } catch {
      return
    }
  }
}

export const backendUserSettingsRouter = router({
  query: backendProcedure
    .input(collectionQuerySchema)
    .query(
      async ({ ctx, input }) => await ctx.userSettingsService.query(ctx.requestContext, input),
    ),
  get: backendProcedure
    .input(userInput)
    .query(
      async ({ ctx, input }) => await ctx.userSettingsService.get(ctx.requestContext, input.userId),
    ),
  roleBindings: backendProcedure
    .input(userInput)
    .query(
      async ({ ctx, input }) =>
        await ctx.userSettingsService.getRoleBindings(ctx.requestContext, input.userId),
    ),
  watch: backendProcedure
    .input(watchInput)
    .subscription(({ ctx, input, signal }) =>
      watchUsers(ctx, input.userId, input.bindings, signal),
    ),
})

export const projectUserSettingsRouter = router({
  query: projectProcedure
    .input(projectInput.extend({ query: collectionQuerySchema }))
    .query(
      async ({ ctx, input }) =>
        await ctx.userSettingsService.query(ctx.requestContext, input.query),
    ),
  get: projectProcedure
    .input(projectInput.extend(userInput.shape))
    .query(
      async ({ ctx, input }) => await ctx.userSettingsService.get(ctx.requestContext, input.userId),
    ),
  roleBindings: projectProcedure
    .input(projectInput.extend(userInput.shape))
    .query(
      async ({ ctx, input }) =>
        await ctx.userSettingsService.getRoleBindings(ctx.requestContext, input.userId),
    ),
  watch: projectProcedure
    .input(projectInput.extend(watchInput.shape))
    .subscription(({ ctx, input, signal }) =>
      watchUsers(ctx, input.userId, input.bindings, signal),
    ),
})

import type { DesignerIdentity, Services } from "@highstate/backend"
import {
  hasBackendPermissionSubset,
  hasProjectPermissionSubset,
  resolveHumanBackendContext,
  resolveHumanProjectContext,
} from "@highstate/backend"
import { OperationNotFoundError, PermissionDeniedError } from "@highstate/backend/shared"
import { initTRPC, TRPCError } from "@trpc/server"
import superjson from "superjson"
import { z } from "zod"
import { ensureLocalBackendUser } from "./authentication"
import { isHostedAuth } from "./utils/auth-config"
import { initializeHostedProjectAuth } from "./utils/auth-initialization"
import { authenticateHostedSession } from "./utils/hosted-session"
import { protectSessionStream } from "./utils/session-stream"

export type Context = Services & { designerSessionToken?: string }

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  sse: {
    maxDurationMs: 3600000,
    ping: { enabled: true, intervalMs: 2000 },
    client: { reconnectAfterInactivityMs: 5000 },
  },
})

async function authenticate(services: Context): Promise<DesignerIdentity> {
  if (isHostedAuth()) {
    try {
      return await authenticateHostedSession(services, services.designerSessionToken)
    } catch {
      throw new TRPCError({ code: "UNAUTHORIZED" })
    }
  }

  const user = await ensureLocalBackendUser(services)
  return {
    id: user.id,
    type: "local",
    meta: { title: user.username, username: user.username },
    groups: [],
  }
}

const authenticatedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const identity = await authenticate(ctx)
  const revalidate: (() => Promise<void>)[] = []
  const result = await next({ ctx: { ...ctx, identity, revalidate } })
  if (!result.ok && result.error.cause instanceof PermissionDeniedError) {
    throw new TRPCError({ code: "FORBIDDEN", cause: result.error.cause })
  }

  if (!result.ok && result.error.cause instanceof OperationNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", cause: result.error.cause })
  }

  if (
    isHostedAuth() &&
    result.ok &&
    result.data &&
    typeof result.data === "object" &&
    Symbol.asyncIterator in result.data
  ) {
    return {
      ...result,
      data: protectSessionStream(result.data as AsyncIterable<unknown>, async () => {
        await authenticateHostedSession(ctx, ctx.designerSessionToken)

        for (const validate of revalidate) {
          await validate()
        }
      }),
    }
  }

  return result
})

export const backendProcedure = authenticatedProcedure.use(async ({ ctx, next }) => {
  const requestContext = await resolveHumanBackendContext(
    ctx.database,
    ctx.identity,
    !isHostedAuth(),
  )

  ctx.revalidate.push(async () => {
    const current = await resolveHumanBackendContext(ctx.database, await authenticate(ctx))

    for (const [permission, grants] of requestContext.permissions) {
      for (const grant of grants) {
        if (!hasBackendPermissionSubset(current, permission, grant.restrictions)) {
          throw new TRPCError({ code: "FORBIDDEN" })
        }
      }
    }
  })

  return next({ ctx: { ...ctx, requestContext } })
})

export const projectProcedure = authenticatedProcedure
  .input(z.object({ projectId: z.string().min(1) }))
  .use(async ({ ctx, input, next }) => {
    if (isHostedAuth()) {
      await initializeHostedProjectAuth(ctx, input.projectId)
    }

    const requestContext = await resolveHumanProjectContext(
      ctx.database,
      ctx.identity,
      input.projectId,
      !isHostedAuth(),
    )

    ctx.revalidate.push(async () => {
      const current = await resolveHumanProjectContext(
        ctx.database,
        await authenticate(ctx),
        input.projectId,
      )

      for (const [permission, grants] of requestContext.permissions) {
        for (const grant of grants) {
          if (!hasProjectPermissionSubset(current, permission, grant.restrictions)) {
            throw new TRPCError({ code: "FORBIDDEN" })
          }
        }
      }
    })

    return next({ ctx: { ...ctx, requestContext } })
  })

export const router = t.router
export const middleware = t.middleware

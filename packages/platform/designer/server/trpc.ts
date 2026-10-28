import type { DesignerIdentity, Services } from "@highstate/backend"
import type { ProjectPermission } from "@highstate/backend/shared"
import {
  hasBackendPermissionSubset,
  hasProjectPermissionSubset,
  requireBackendPermission,
  requireProjectPermission,
  resolveHumanBackendContext,
  resolveHumanProjectContext,
} from "@highstate/backend"
import { PermissionDeniedError } from "@highstate/backend/shared"
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

// legacy direct-manager and raw-table paths need explicit domain permissions
// Collection/event paths intentionally require an unrestricted grant because their payloads are not filtered.
const legacyPermissions: Record<string, ProjectPermission> = {
  "state.watchInstanceStates": "instance-state.list",
  "state.getInstanceLocks": "instance-state.list",
  "state.watchInstanceLocks": "instance-state.list",
  "state.getPage": "page.get",
  "state.getInstancePages": "page.get",
  "state.createPanelLaunch": "panel.get",
  "state.watchPanelAvailability": "panel.get",
  "state.getInstanceTriggers": "trigger.get",
  "project.watchProjectNodes": "instance-model.get",
  "terminal.getOrCreateTerminalSession": "terminal.connect",
  "terminal.getTerminals": "terminal.get",
  "terminal.watchSession": "terminal.get",
  "operation.getLastOperations": "operation.list",
  "operation.launch": "operation.create",
  "operation.plan": "operation.create",
  "operation.watch": "operation.list",
  "operation.cancel": "operation.cancel",
  "operation.cancelInstance": "operation.cancel",
  "logs.watchInstanceLogs": "operation.logs.get",
  "logs.watchWorkerVersionLogs": "worker-version.get",
  "worker.restartVersion": "worker-version.restart",
  "worker.watchVersionStatuses": "worker-version.list",
}

export const publicProcedure = authenticatedProcedure.use(
  async ({ ctx, path, getRawInput, next }) => {
    if (!isHostedAuth()) {
      return next()
    }

    const input = z.record(z.string(), z.unknown()).parse(await getRawInput())

    if (path.startsWith("library.")) {
      const context = await resolveHumanBackendContext(ctx.database, ctx.identity)

      requireBackendPermission(context, "library.get", {
        resourceId: z.string().parse(input.libraryId),
      })

      ctx.revalidate.push(async () => {
        const identity = await authenticate(ctx)
        const current = await resolveHumanBackendContext(ctx.database, identity)

        requireBackendPermission(current, "library.get", {
          resourceId: z.string().parse(input.libraryId),
        })
      })

      return next()
    }

    const permission = legacyPermissions[path]
    if (!permission) {
      throw new TRPCError({ code: "FORBIDDEN" })
    }

    const projectId = z.string().min(1).parse(input.projectId)
    await initializeHostedProjectAuth(ctx, projectId)
    const context = await resolveHumanProjectContext(ctx.database, ctx.identity, projectId)
    requireProjectPermission(context, permission)

    ctx.revalidate.push(async () => {
      const identity = await authenticate(ctx)
      const current = await resolveHumanProjectContext(ctx.database, identity, projectId)
      requireProjectPermission(current, permission)
    })

    // active terminal sessions are indexed globally by the manager
    if (path === "terminal.watchSession") {
      const database = await ctx.database.forProject(projectId)
      if (
        !(await database.terminalSession.findUnique({
          where: { id: z.string().parse(input.sessionId) },
        }))
      ) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
    }

    if (path === "logs.watchInstanceLogs") {
      const database = await ctx.database.forProject(projectId)
      if (
        !(await database.operation.findUnique({
          where: { id: z.string().parse(input.operationId) },
        })) ||
        !(await database.instanceState.findUnique({
          where: { id: z.string().parse(input.stateId) },
        }))
      ) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
    }

    // Manager cancellation is global; establish project ownership before calling it.
    if (path === "operation.cancel" || path === "operation.cancelInstance") {
      const database = await ctx.database.forProject(projectId)
      if (
        !(await database.operation.findUnique({
          where: { id: z.string().parse(input.operationId) },
        }))
      ) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
    }

    return next()
  },
)

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
  .input(z.object({ projectId: z.cuid2() }))
  .use(async ({ ctx, input, path, next }) => {
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

    if (path.startsWith("workspace.")) {
      requireProjectPermission(requestContext, "instance-model.get")
    }

    return next({ ctx: { ...ctx, requestContext } })
  })

export const router = t.router
export const middleware = t.middleware

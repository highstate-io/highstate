import type {
  ResolvedPermissions,
  Services,
  UserBackendRequestContext,
  UserProjectRequestContext,
} from "@highstate/backend"
import type {
  BackendPermission,
  BackendPermissionRestriction,
  ProjectPermission,
  ProjectPermissionRestriction,
} from "@highstate/backend/shared"
import { backendPermissionGroups, projectPermissionGroups } from "@highstate/backend/shared"
import { initTRPC } from "@trpc/server"
import superjson from "superjson"
import { z } from "zod"
import { ensureLocalBackendUser } from "./authentication"

export type Context = Services

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  sse: {
    maxDurationMs: 3600_000,

    ping: {
      enabled: true,
      intervalMs: 2_000,
    },

    client: {
      reconnectAfterInactivityMs: 5_000,
    },
  },
})

export const publicProcedure = t.procedure

export const backendProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const requestContext = await authenticateBackendRequest(ctx)

  return next({ ctx: { ...ctx, requestContext } })
})

export const projectProcedure = publicProcedure
  .input(z.object({ projectId: z.cuid2() }))
  .use(async ({ ctx, input, next }) => {
    const requestContext = await authenticateProjectRequest(ctx, input.projectId)

    return next({ ctx: { ...ctx, requestContext } })
  })

export const router = t.router
export const middleware = t.middleware

async function authenticateBackendRequest(services: Services): Promise<UserBackendRequestContext> {
  const user = await ensureLocalBackendUser(services)

  return {
    realm: "backend",
    subject: { type: "user", userId: user.id, groupIds: [] },
    permissions: createUnrestrictedPermissions(
      backendPermissionGroups.flatMap(group =>
        group.permissions.map(permission => permission.name),
      ),
    ),
  }
}

async function authenticateProjectRequest(
  services: Services,
  projectId: string,
): Promise<UserProjectRequestContext> {
  const user = await ensureLocalBackendUser(services)
  const database = await services.database.forProject(projectId)
  await database.user.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      type: "local",
      meta: { title: user.username, username: user.username },
    },
    update: {
      type: "local",
      meta: { title: user.username, username: user.username },
    },
  })

  return {
    realm: "project",
    projectId,
    subject: { type: "user", userId: user.id, groupIds: [] },
    permissions: createUnrestrictedPermissions(
      projectPermissionGroups.flatMap(group =>
        group.permissions.map(permission => permission.name),
      ),
    ),
  }
}

function createUnrestrictedPermissions<
  TPermission extends BackendPermission | ProjectPermission,
  TRestriction extends BackendPermissionRestriction | ProjectPermissionRestriction,
>(permissions: readonly TPermission[]): ResolvedPermissions<TPermission, TRestriction> {
  return new Map(permissions.map(permission => [permission, [{ restrictions: [] }]]))
}

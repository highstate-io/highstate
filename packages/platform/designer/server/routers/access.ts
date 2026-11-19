import type { Services } from "@highstate/backend"
import { setTimeout as delay } from "node:timers/promises"
import {
  hasBackendPermission,
  hasProjectPermission,
  resolveBackendProjectPermissionTarget,
  resolveHumanBackendContext,
  resolveHumanProjectContext,
} from "@highstate/backend"
import { backendPermissionSchema, projectPermissionSchema } from "@highstate/backend/shared"
import { instanceIdSchema, z } from "@highstate/contract"
import { authenticatedProcedure, backendProcedure, projectProcedure, router } from "../trpc"
import { isHostedAuth } from "../utils/auth-config"
import { initializeHostedProjectAuth } from "../utils/auth-initialization"
import { authenticateHostedSession } from "../utils/hosted-session"

const targetSchema = z.object({
  artifactHash: z.string().optional(),
  resourceId: z.string().optional(),
  instanceId: instanceIdSchema.optional(),
  ancestorInstanceIds: z.array(instanceIdSchema).optional(),
  ownerServiceAccountId: z.string().optional(),
  workerId: z.string().optional(),
  projectId: z.string().optional(),
  projectSpaceId: z.string().optional(),
  ancestorProjectSpaceIds: z.array(z.string()).optional(),
})

const checkSchema = z.object({
  key: z.string().max(4096),
  collection: z.boolean().optional(),
  target: targetSchema.optional(),
})

type HierarchyState = { id: string; instanceId: string; parentId: string | null }
async function projectTarget(
  services: Services,
  projectId: string,
  target: z.infer<typeof targetSchema> | undefined,
  cache: Map<string, Promise<HierarchyState[]>>,
) {
  if (target?.artifactHash) {
    const database = await services.database.forProject(projectId)
    const artifact = await database.artifact.findUnique({ where: { hash: target.artifactHash } })

    if (!artifact) {
      throw new Error("Artifact unavailable")
    }

    return { ...target, resourceId: artifact.id }
  }

  if (!target?.instanceId || target.ancestorInstanceIds) {
    return target
  }

  const database = await services.database.forProject(projectId)

  if (!cache.has(projectId)) {
    cache.set(
      projectId,
      database.instanceState.findMany({ select: { id: true, instanceId: true, parentId: true } }),
    )
  }

  const states = await cache.get(projectId)!
  const byId = new Map(states.map(state => [state.id, state]))
  const ancestors: z.infer<typeof instanceIdSchema>[] = []
  const visited = new Set<string>()
  let parentId = states.find(state => state.instanceId === target.instanceId)?.parentId

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) {
      break
    }

    ancestors.push(instanceIdSchema.parse(parent.instanceId))
    parentId = parent.parentId
  }

  return { ...target, ancestorInstanceIds: ancestors }
}

async function backendTarget(services: Services, target: z.infer<typeof targetSchema> | undefined) {
  if (!target?.projectId) {
    return target
  }

  return {
    ...target,
    ...(await resolveBackendProjectPermissionTarget(services.database, target.projectId)),
  }
}

// advisory UI checks only: business services remain authoritative for every request
export const accessRouter = router({
  watch: authenticatedProcedure
    .input(
      z.object({
        checks: z
          .array(
            z.discriminatedUnion("realm", [
              checkSchema.extend({
                realm: z.literal("backend"),
                permission: backendPermissionSchema,
              }),
              checkSchema.extend({
                realm: z.literal("project"),
                projectId: z.string(),
                permission: projectPermissionSchema,
              }),
            ]),
          )
          .max(200),
      }),
    )
    .subscription(async function* ({ ctx, input, signal }) {
      let previous = ""
      const initialized = new Set<string>()

      while (!signal?.aborted) {
        const identity = isHostedAuth()
          ? await authenticateHostedSession(ctx, ctx.designerSessionToken)
          : ctx.identity

        const backend = await resolveHumanBackendContext(ctx.database, identity, !isHostedAuth())
        const projects = new Map<string, Awaited<ReturnType<typeof resolveHumanProjectContext>>>()
        const hierarchy = new Map<string, Promise<HierarchyState[]>>()
        const results: { key: string; allowed: boolean; reason?: string }[] = []

        for (const check of input.checks) {
          try {
            if (check.realm === "backend") {
              results.push({
                key: check.key,
                allowed: check.collection
                  ? (backend.permissions.get(check.permission)?.length ?? 0) > 0
                  : hasBackendPermission(
                      backend,
                      check.permission,
                      await backendTarget(ctx, check.target),
                    ),
              })

              continue
            }

            if (!initialized.has(check.projectId)) {
              if (isHostedAuth()) {
                await initializeHostedProjectAuth(ctx, check.projectId)
              }

              initialized.add(check.projectId)
            }

            let project = projects.get(check.projectId)
            if (!project) {
              project = await resolveHumanProjectContext(
                ctx.database,
                identity,
                check.projectId,
                !isHostedAuth(),
              )

              projects.set(check.projectId, project)
            }

            results.push({
              key: check.key,
              allowed: check.collection
                ? (project.permissions.get(check.permission)?.length ?? 0) > 0
                : hasProjectPermission(
                    project,
                    check.permission,
                    await projectTarget(ctx, check.projectId, check.target, hierarchy),
                  ),
            })
          } catch {
            results.push({
              key: check.key,
              allowed: false,
              reason: "Project access is unavailable while the project is locked or disconnected.",
            })
          }
        }

        const serialized = JSON.stringify(results)
        if (serialized !== previous) {
          previous = serialized
          yield results
        }

        try {
          await delay(1000, undefined, { signal })
        } catch {
          return
        }
      }
    }),
  backend: backendProcedure
    .input(
      z.object({
        checks: z.array(checkSchema.extend({ permission: backendPermissionSchema })).max(200),
      }),
    )
    .query(
      async ({ ctx, input }) =>
        await Promise.all(
          input.checks.map(async check => ({
            key: check.key,
            allowed: check.collection
              ? (ctx.requestContext.permissions.get(check.permission)?.length ?? 0) > 0
              : hasBackendPermission(
                  ctx.requestContext,
                  check.permission,
                  await backendTarget(ctx, check.target),
                ),
          })),
        ),
    ),
  project: projectProcedure
    .input(
      z.object({
        checks: z.array(checkSchema.extend({ permission: projectPermissionSchema })).max(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      const hierarchy = new Map<string, Promise<HierarchyState[]>>()
      return await Promise.all(
        input.checks.map(async check => ({
          key: check.key,
          allowed: check.collection
            ? (ctx.requestContext.permissions.get(check.permission)?.length ?? 0) > 0
            : hasProjectPermission(
                ctx.requestContext,
                check.permission,
                await projectTarget(ctx, input.projectId, check.target, hierarchy),
              ),
        })),
      )
    }),
})

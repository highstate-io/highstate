import type { BackendRequestContext, ProjectRequestContext } from "../../common"
import type { DatabaseManager } from "../../database"
import type { CollectionQuery, HumanRoleBindingOption, PageResult, UserOutput } from "../../shared"
import { createHash } from "node:crypto"
import {
  buildBackendAuthorizationWhere,
  buildProjectAuthorizationWhere,
  hasBackendPermissionRulesSubset,
  hasProjectPermissionRulesSubset,
  requireBackendPermission,
  requireProjectPermission,
} from "../../common"
import { backendRoleRulesSchema, projectRoleRulesSchema, userOutputSchema } from "../../shared"
import { querySettingsPage } from "./shared"

type HumanDirectoryContext = BackendRequestContext | ProjectRequestContext
const userSelect = { id: true, type: true, meta: true, createdAt: true, updatedAt: true } as const

export class UserSettingsService {
  constructor(private readonly database: DatabaseManager) {}

  /**
   * Lists the global known-user directory under the selected realm's permissions.
   */
  async query(
    context: HumanDirectoryContext,
    query: CollectionQuery,
  ): Promise<PageResult<UserOutput>> {
    this.requirePermission(context, "user.list")

    // SQLite and PostgreSQL use different JSON-path filters and ordering.
    // normalize the human directory before applying metadata search and pagination
    const users = (await this.database.backend.user.findMany({ select: userSelect })).map(user =>
      userOutputSchema.parse(user),
    )

    const search = query.search?.trim().toLocaleLowerCase()

    const filtered = search
      ? users.filter(user =>
          [user.id, user.meta.title, user.meta.username, user.meta.email, user.type].some(value =>
            value?.toLocaleLowerCase().includes(search),
          ),
        )
      : users

    const sort = query.sortBy?.length ? query.sortBy : [{ key: "meta.title", order: "asc" }]

    filtered.sort((a, b) => {
      for (const field of sort) {
        const value = (user: UserOutput) => {
          switch (field.key) {
            case "meta.title":
              return user.meta.title
            case "email":
              return user.meta.email ?? ""
            case "type":
              return user.type
            case "createdAt":
              return user.createdAt.getTime()
            default:
              return user.id
          }
        }

        const left = value(a)
        const right = value(b)

        const order =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right))

        if (order) {
          return field.order === "desc" ? -order : order
        }
      }

      return a.id.localeCompare(b.id)
    })

    return await querySettingsPage({
      collection: "known-users",
      request: { ...query, pageSize: query.pageSize || 20 },
      query: {
        ...query,
        realm: context.realm,
        projectId: context.realm === "project" ? context.projectId : undefined,
      },
      fetch: async ({ cursorId, take }) => {
        const index = cursorId ? filtered.findIndex(user => user.id === cursorId) : -1
        return cursorId && index < 0 ? [] : filtered.slice(index + 1, index + 1 + take)
      },
    })
  }

  /**
   * Reads a user's public identity metadata, without exposing browser sessions.
   */
  async get(context: HumanDirectoryContext, userId: string): Promise<UserOutput | null> {
    this.requirePermission(context, "user.get")

    const user = await this.database.backend.user.findUnique({
      where: { id: userId },
      select: userSelect,
    })

    return user ? userOutputSchema.parse(user) : null
  }

  /**
   * Lists visible roles and the user's direct bindings in exactly one realm.
   */
  async getRoleBindings(
    context: HumanDirectoryContext,
    userId: string,
  ): Promise<HumanRoleBindingOption[]> {
    this.requirePermission(context, "user.get")
    this.requirePermission(context, "role-binding.list")

    if (context.realm === "backend") {
      const where = await buildBackendAuthorizationWhere({
        database: this.database,
        context,
        permission: "role.list",
        target: { resources: ids => ({ id: { in: [...ids] } }) },
      })

      const roles = await this.database.backend.backendRole.findMany({
        where,
        select: {
          id: true,
          meta: true,
          rules: true,
          userBindings: { where: { userId }, select: { userId: true } },
        },
        orderBy: { id: "asc" },
      })

      return roles.map(role => ({
        id: role.id,
        meta: role.meta,
        granted: role.userBindings.length > 0,
        requiresEscalation: !hasBackendPermissionRulesSubset(
          context,
          backendRoleRulesSchema.parse(role.rules),
        ),
      }))
    }

    const project = await this.database.forProject(context.projectId)

    const where = await buildProjectAuthorizationWhere({
      database: this.database,
      context,
      permission: "role.list",
      target: { resources: ids => ({ id: { in: [...ids] } }) },
    })

    const roles = await project.role.findMany({
      where,
      select: {
        id: true,
        meta: true,
        rules: true,
        userBindings: { where: { userId }, select: { userId: true } },
      },
      orderBy: { id: "asc" },
    })

    return roles.map(role => ({
      id: role.id,
      meta: role.meta,
      granted: role.userBindings.length > 0,
      requiresEscalation: !hasProjectPermissionRulesSubset(
        context,
        projectRoleRulesSchema.parse(role.rules),
      ),
    }))
  }

  /**
   * Produces a live directory/binding revision without returning session material.
   */
  async getRevision(
    context: HumanDirectoryContext,
    userId?: string,
    includeBindings = !!userId,
  ): Promise<string> {
    let users: unknown

    if (userId) {
      const user = await this.get(context, userId)
      users = user ? { id: user.id, type: user.type, meta: user.meta } : null
    } else {
      this.requirePermission(context, "user.list")

      users = await this.database.backend.user.findMany({
        select: { id: true, type: true, meta: true },
        orderBy: { id: "asc" },
      })
    }

    const bindings =
      userId && includeBindings ? await this.getRoleBindings(context, userId) : undefined

    return createHash("sha256").update(JSON.stringify({ users, bindings })).digest("hex")
  }

  private requirePermission(
    context: HumanDirectoryContext,
    permission: "user.list" | "user.get" | "role-binding.list",
  ): void {
    if (context.realm === "backend") {
      requireBackendPermission(context, permission)
    } else {
      requireProjectPermission(context, permission)
    }
  }
}

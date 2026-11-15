import type { DatabaseManager } from "../../database"
import type {
  BackendPermission,
  BackendPermissionRestriction,
  ProjectPermission,
  ProjectPermissionRestriction,
} from "../../shared"
import { expect, test, vi } from "vitest"
import { resolveHumanPermissions } from "../../authentication/human"
import { InvalidPageTokenError, PermissionDeniedError } from "../../shared"
import { UserSettingsService } from "./users"

const adminId = "aaaaaaaaaaaaaaaaaaaaaaaa"
const viewerId = "bbbbbbbbbbbbbbbbbbbbbbbb"
const roleId = "cccccccccccccccccccccccc"
const date = new Date("2026-11-15T00:00:00Z")

const backendContext = (permissions: BackendPermission[]) => ({
  realm: "backend" as const,
  subject: { type: "user" as const, userId: adminId, groupIds: [] },
  permissions: resolveHumanPermissions<BackendPermission, BackendPermissionRestriction>([
    { permissions },
  ]),
})

const projectContext = (permissions: ProjectPermission[]) => ({
  realm: "project" as const,
  projectId: "project",
  subject: { type: "user" as const, userId: adminId, groupIds: [] },
  permissions: resolveHumanPermissions<ProjectPermission, ProjectPermissionRestriction>([
    { permissions },
  ]),
})

function fixture() {
  const users = [
    {
      id: adminId,
      type: "oidc",
      meta: { title: "Administrator", email: "admin@example.test" },
      createdAt: date,
      updatedAt: date,
      designerSessions: [{ tokenHash: "private-session-material" }],
    },
    {
      id: viewerId,
      type: "oauth",
      meta: { title: "Viewer", username: "viewer", email: "viewer@example.test" },
      createdAt: date,
      updatedAt: date,
    },
  ]

  const findUsers = vi.fn().mockResolvedValue(users)

  const backendRoles = vi.fn().mockResolvedValue([
    {
      id: roleId,
      meta: { title: "Backend reader" },
      rules: [{ permissions: ["user.get"] }],
      userBindings: [{ userId: viewerId }],
    },
  ])

  const projectRoles = vi.fn().mockResolvedValue([
    {
      id: roleId,
      meta: { title: "Project operator" },
      rules: [{ permissions: ["operation.create"] }],
      userBindings: [],
    },
  ])

  const forProject = vi.fn().mockResolvedValue({ role: { findMany: projectRoles } })

  const database = {
    backend: {
      user: {
        findMany: findUsers,
        findUnique: vi
          .fn()
          .mockImplementation(({ where }) => users.find(user => user.id === where.id) ?? null),
      },
      backendRole: { findMany: backendRoles },
    },
    forProject,
  } as unknown as DatabaseManager

  return {
    service: new UserSettingsService(database),
    database,
    users,
    findUsers,
    backendRoles,
    projectRoles,
    forProject,
  }
}

test("requires the selected realm's user-list permission before reading the directory", async () => {
  const { service, findUsers } = fixture()
  await expect(service.query(backendContext([]), {})).rejects.toBeInstanceOf(PermissionDeniedError)
  await expect(service.query(projectContext([]), {})).rejects.toBeInstanceOf(PermissionDeniedError)
  expect(findUsers).not.toHaveBeenCalled()
})

test("shows globally known users in projects without requiring prior project participation", async () => {
  const { service, forProject } = fixture()
  const result = await service.query(projectContext(["user.list"]), {})
  expect(result.items.map(user => user.id)).toEqual([adminId, viewerId])
  expect(forProject).not.toHaveBeenCalled()
  expect(result.items[0]).not.toHaveProperty("designerSessions")
})

test("searches identity metadata and paginates deterministically with realm-bound cursors", async () => {
  const { service } = fixture()
  const context = backendContext(["user.list"])
  const found = await service.query(context, { search: "VIEWER@EXAMPLE.TEST" })
  expect(found.items.map(user => user.id)).toEqual([viewerId])
  const first = await service.query(context, { pageSize: 1 })
  const second = await service.query(context, { pageSize: 1, pageToken: first.nextPageToken })
  expect(first.items.map(user => user.id)).toEqual([adminId])
  expect(second.items.map(user => user.id)).toEqual([viewerId])

  await expect(
    service.query(projectContext(["user.list"]), { pageSize: 1, pageToken: first.nextPageToken }),
  ).rejects.toBeInstanceOf(InvalidPageTokenError)
})

test("reads public user metadata without exposing durable sessions", async () => {
  const { service, database } = fixture()

  await expect(service.get(backendContext([]), adminId)).rejects.toBeInstanceOf(
    PermissionDeniedError,
  )

  const user = await service.get(backendContext(["user.get"]), adminId)
  expect(user?.meta.title).toBe("Administrator")
  expect(user).not.toHaveProperty("designerSessions")

  expect(database.backend.user.findUnique).toHaveBeenCalledWith({
    where: { id: adminId },
    select: { id: true, type: true, meta: true, createdAt: true, updatedAt: true },
  })
})

test("keeps realm bindings separate and identifies roles requiring escalation", async () => {
  const { service, backendRoles, projectRoles } = fixture()

  const backend = await service.getRoleBindings(
    backendContext(["user.get", "role.list", "role-binding.list"]),
    viewerId,
  )

  expect(backend).toEqual([
    { id: roleId, meta: { title: "Backend reader" }, granted: true, requiresEscalation: false },
  ])

  expect(projectRoles).not.toHaveBeenCalled()
  backendRoles.mockClear()

  const project = await service.getRoleBindings(
    projectContext(["user.get", "role.list", "role-binding.list"]),
    viewerId,
  )

  expect(project).toEqual([
    { id: roleId, meta: { title: "Project operator" }, granted: false, requiresEscalation: true },
  ])

  expect(backendRoles).not.toHaveBeenCalled()
})

test("filters visible role options by resource-scoped role-list grants", async () => {
  const { service, backendRoles } = fixture()
  const context = backendContext(["user.get", "role-binding.list"])
  const permissions = new Map(context.permissions)

  permissions.set("role.list", [{ restrictions: [{ type: "resources", resourceIds: [roleId] }] }])

  context.permissions = permissions
  await service.getRoleBindings(context, viewerId)

  expect(backendRoles.mock.calls[0]![0].where).toEqual({
    OR: [{ AND: [{ id: { in: [roleId] } }] }],
  })
})

test("does not read bindings without the corresponding read permissions", async () => {
  const { service, backendRoles, forProject } = fixture()

  await expect(
    service.getRoleBindings(backendContext(["user.get", "role.list"]), viewerId),
  ).rejects.toBeInstanceOf(PermissionDeniedError)

  await expect(
    service.getRoleBindings(projectContext(["user.get", "role.list"]), viewerId),
  ).rejects.toBeInstanceOf(PermissionDeniedError)

  expect(backendRoles).not.toHaveBeenCalled()
  expect(forProject).not.toHaveBeenCalled()
})

test("changes live revisions when identities or direct bindings change", async () => {
  const { service, backendRoles, users } = fixture()
  const context = backendContext(["user.list", "user.get", "role.list", "role-binding.list"])
  const initial = await service.getRevision(context, viewerId)

  backendRoles.mockResolvedValue([
    {
      id: roleId,
      meta: { title: "Backend reader" },
      rules: [{ permissions: ["user.get"] }],
      userBindings: [],
    },
  ])

  const unbound = await service.getRevision(context, viewerId)
  expect(unbound).not.toBe(initial)
  users[1]!.meta.title = "Renamed viewer"
  expect(await service.getRevision(context, viewerId)).not.toBe(unbound)
})

test("watches one public profile without requiring directory or binding-list access", async () => {
  const { service, backendRoles, findUsers } = fixture()

  expect(await service.getRevision(backendContext(["user.get"]), viewerId, false)).toMatch(
    /^[a-f0-9]{64}$/,
  )

  expect(backendRoles).not.toHaveBeenCalled()
  expect(findUsers).not.toHaveBeenCalled()
})

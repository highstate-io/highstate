import type { DatabaseManager } from "../database"
import { describe, expect, test, vi } from "vitest"
import { hasBackendPermission, hasProjectPermission } from "../common"
import {
  resolveHumanBackendContext,
  resolveHumanProjectContext,
  setHumanBackendRoleBinding,
  setHumanProjectRoleBinding,
} from "./human"

const identity = {
  id: "human",
  type: "oidc" as const,
  meta: { title: "Human" },
  groups: [{ id: "group", title: "Group" }],
}

describe("human authorization", () => {
  test("cannot opt a hosted identity into trusted-local authorization", async () => {
    const database = {} as DatabaseManager

    await expect(resolveHumanBackendContext(database, identity, true)).rejects.toThrow(
      "Local identity required",
    )

    await expect(resolveHumanProjectContext(database, identity, "project", true)).rejects.toThrow(
      "Local identity required",
    )
  })

  test("reloads user and group role bindings on each request", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ rules: [{ permissions: ["backend.update"] }] }])
      .mockResolvedValueOnce([])

    const database = { backend: { backendRole: { findMany } } } as unknown as DatabaseManager

    expect(
      hasBackendPermission(await resolveHumanBackendContext(database, identity), "backend.update"),
    ).toBe(true)

    expect(
      hasBackendPermission(await resolveHumanBackendContext(database, identity), "backend.update"),
    ).toBe(false)
  })

  test("denies stronger project group grants before copying subjects or writing bindings", async () => {
    const upsert = vi.fn()

    const database = {
      forProject: vi.fn().mockResolvedValue({
        role: {
          findUniqueOrThrow: vi
            .fn()
            .mockResolvedValue({ rules: [{ permissions: ["secret.get"] }] }),
        },
        userGroupRoleBinding: { upsert },
      }),
    } as unknown as DatabaseManager

    await expect(
      setHumanProjectRoleBinding(
        database,
        {
          realm: "project",
          projectId: "project",
          subject: { type: "user", userId: "human", groupIds: [] },
          permissions: new Map([["role.update", [{ restrictions: [] }]]]),
        },
        {
          roleId: "x123456789012345678901234",
          subject: { type: "group", id: "y123456789012345678901234" },
          granted: true,
        },
      ),
    ).rejects.toThrow()

    expect(upsert).not.toHaveBeenCalled()
  })

  test("does not grant privileges to an authenticated human without bindings", async () => {
    const backendRole = { findMany: vi.fn().mockResolvedValue([]) }
    const database = { backend: { backendRole } } as unknown as DatabaseManager
    const context = await resolveHumanBackendContext(database, identity)
    expect(hasBackendPermission(context, "backend.update")).toBe(false)

    expect(backendRole.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { userBindings: { some: { userId: "human" } } },
            { groupBindings: { some: { groupId: { in: ["group"] } } } },
          ],
        },
      }),
    )
  })

  test("preserves project resource restrictions and does not inherit backend privileges", async () => {
    const project = {
      user: { upsert: vi.fn() },
      role: {
        findMany: vi.fn().mockResolvedValue([
          {
            rules: [
              {
                permissions: ["terminal.connect"],
                restrictions: [{ type: "resources", resourceIds: ["allowed"] }],
              },
            ],
          },
        ]),
      },
    }

    const database = {
      forProject: vi.fn().mockResolvedValue(project),
    } as unknown as DatabaseManager

    const context = await resolveHumanProjectContext(database, identity, "project")
    expect(hasProjectPermission(context, "terminal.connect", { resourceId: "allowed" })).toBe(true)
    expect(hasProjectPermission(context, "terminal.connect", { resourceId: "other" })).toBe(false)
    expect(hasProjectPermission(context, "operation.create")).toBe(false)
  })

  test("denies binding a stronger role without escalation permission", async () => {
    const upsert = vi.fn()
    const roleId = "x123456789012345678901234"

    const database = {
      backend: {
        backendRole: {
          findUniqueOrThrow: vi
            .fn()
            .mockResolvedValue({ rules: [{ permissions: ["backend.update"] }] }),
        },
        userBackendRoleBinding: { upsert },
      },
    } as unknown as DatabaseManager

    await expect(
      setHumanBackendRoleBinding(
        database,
        {
          realm: "backend",
          subject: { type: "user", userId: "human", groupIds: [] },
          permissions: new Map([["role.update", [{ restrictions: [] }]]]),
        },
        { roleId, subject: { type: "user", id: "y123456789012345678901234" }, granted: true },
      ),
    ).rejects.toThrow()

    expect(upsert).not.toHaveBeenCalled()
  })
})

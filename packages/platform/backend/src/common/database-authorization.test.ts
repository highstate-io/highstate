import type { DatabaseManager, ProjectWhereInput, SecretWhereInput } from "../database"
import { describe, expect, test, vi } from "vitest"
import {
  createBackendRequestContext,
  createProjectRequestContext,
  grantBackendPermission,
  grantProjectPermission,
} from "../test-utils"
import {
  buildBackendAuthorizationWhere,
  buildProjectAuthorizationWhere,
} from "./database-authorization"

describe("database authorization", () => {
  test("expands recursive instance restrictions into state IDs", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "root-state", instanceId: "example.v1:root", parentId: null },
      { id: "child-state", instanceId: "example.v1:child", parentId: "root-state" },
      { id: "other-state", instanceId: "example.v1:other", parentId: null },
    ])
    const database = {
      forProject: vi.fn().mockResolvedValue({ instanceState: { findMany } }),
    } as unknown as DatabaseManager
    const context = createProjectRequestContext(
      "project",
      grantProjectPermission("secret.list", [
        { type: "instances", instanceIds: ["example.v1:root"], recursive: true },
      ]),
    )

    const where = await buildProjectAuthorizationWhere<SecretWhereInput>({
      database,
      context,
      permission: "secret.list",
      target: {
        instances: scope => ({ stateId: { in: [...scope.stateIds] } }),
      },
    })

    expect(where).toEqual({
      OR: [{ AND: [{ stateId: { in: ["root-state", "child-state"] } }] }],
    })
    expect(findMany).toHaveBeenCalledOnce()
  })

  test("expands recursive project-space restrictions into space IDs", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "root-space", parentId: null },
      { id: "child-space", parentId: "root-space" },
      { id: "other-space", parentId: null },
    ])
    const database = {
      backend: { projectSpace: { findMany } },
    } as unknown as DatabaseManager
    const context = createBackendRequestContext(
      grantBackendPermission("project.list", [
        { type: "projects-in-spaces", projectSpaceIds: ["root-space"], recursive: true },
      ]),
    )

    const where = await buildBackendAuthorizationWhere<ProjectWhereInput>({
      database,
      context,
      permission: "project.list",
      target: {
        projectsInSpaces: ids => ({ spaceId: { in: [...ids] } }),
      },
    })

    expect(where).toEqual({
      OR: [{ AND: [{ spaceId: { in: ["root-space", "child-space"] } }] }],
    })
    expect(findMany).toHaveBeenCalledOnce()
  })

  test("does not load hierarchies for unrestricted grants", async () => {
    const database = {} as DatabaseManager
    const context = createProjectRequestContext("project", grantProjectPermission("secret.list"))

    const where = await buildProjectAuthorizationWhere<SecretWhereInput>({
      database,
      context,
      permission: "secret.list",
      target: {},
    })

    expect(where).toEqual({})
  })

  test("maps every project restriction type to the service predicate", async () => {
    const database = {
      forProject: vi.fn().mockResolvedValue({
        instanceState: {
          findMany: vi.fn().mockResolvedValue([
            { id: "state-1", instanceId: "example.v1:root", parentId: null },
            { id: "state-2", instanceId: "example.v1:child", parentId: "state-1" },
          ]),
        },
      }),
    } as unknown as DatabaseManager
    const context = createProjectRequestContext(
      "project",
      grantProjectPermission("secret.list", [
        { type: "resources", resourceIds: ["resource-1"] },
        { type: "instances", instanceIds: ["example.v1:root"], recursive: true },
        { type: "owners", serviceAccountIds: ["account-1"] },
        { type: "self" },
      ]),
      { type: "service-account", serviceAccountId: "account-1" },
    )

    const where = await buildProjectAuthorizationWhere<SecretWhereInput>({
      database,
      context,
      permission: "secret.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        instances: scope => ({ stateId: { in: [...scope.stateIds] } }),
        owners: ids => ({ serviceAccountId: { in: [...ids] } }),
        self: id => ({ serviceAccountId: id }),
      },
    })

    expect(where).toEqual({
      OR: [
        {
          AND: [
            { id: { in: ["resource-1"] } },
            { stateId: { in: ["state-1", "state-2"] } },
            { serviceAccountId: { in: ["account-1"] } },
            { serviceAccountId: "account-1" },
          ],
        },
      ],
    })
  })

  test("maps every backend restriction type to the service predicate", async () => {
    const database = {
      backend: {
        projectSpace: {
          findMany: vi.fn().mockResolvedValue([
            { id: "space-1", parentId: null },
            { id: "space-2", parentId: "space-1" },
          ]),
        },
      },
    } as unknown as DatabaseManager
    const context = createBackendRequestContext(
      grantBackendPermission("project.list", [
        { type: "resources", resourceIds: ["resource-1"] },
        { type: "projects", projectIds: ["project-1"] },
        { type: "project-spaces", projectSpaceIds: ["space-1"], recursive: true },
        { type: "projects-in-spaces", projectSpaceIds: ["space-1"], recursive: true },
      ]),
    )

    const where = await buildBackendAuthorizationWhere<ProjectWhereInput>({
      database,
      context,
      permission: "project.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        projects: ids => ({ id: { in: [...ids] } }),
        projectSpaces: ids => ({ spaceId: { in: [...ids] } }),
        projectsInSpaces: ids => ({ spaceId: { in: [...ids] } }),
      },
    })

    expect(where).toEqual({
      OR: [
        {
          AND: [
            { id: { in: ["resource-1"] } },
            { id: { in: ["project-1"] } },
            { spaceId: { in: ["space-1", "space-2"] } },
            { spaceId: { in: ["space-1", "space-2"] } },
          ],
        },
      ],
    })
  })

  test("combines grants with OR and restrictions within a grant with AND", async () => {
    const database = {} as DatabaseManager
    const context = createProjectRequestContext(
      "project",
      new Map([
        [
          "secret.list",
          [
            { restrictions: [{ type: "resources", resourceIds: ["resource-1"] }] },
            { restrictions: [{ type: "owners", serviceAccountIds: ["account-1"] }] },
          ],
        ],
      ]),
    )

    const where = await buildProjectAuthorizationWhere<SecretWhereInput>({
      database,
      context,
      permission: "secret.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        owners: ids => ({ serviceAccountId: { in: [...ids] } }),
      },
    })

    expect(where).toEqual({
      OR: [
        { AND: [{ id: { in: ["resource-1"] } }] },
        { AND: [{ serviceAccountId: { in: ["account-1"] } }] },
      ],
    })
  })

  test.each([
    ["project instances", "project"],
    ["backend project spaces", "backend"],
  ])("denies an unknown recursive root in %s", async (_name, realm) => {
    const database = {
      forProject: vi.fn().mockResolvedValue({
        instanceState: { findMany: vi.fn().mockResolvedValue([]) },
      }),
      backend: { projectSpace: { findMany: vi.fn().mockResolvedValue([]) } },
    } as unknown as DatabaseManager

    if (realm === "project") {
      const context = createProjectRequestContext(
        "project",
        grantProjectPermission("secret.list", [
          { type: "instances", instanceIds: ["component.v1:missing"], recursive: true },
        ]),
      )
      await expect(
        buildProjectAuthorizationWhere({
          database,
          context,
          permission: "secret.list",
          target: { instances: ids => ({ stateId: { in: [...ids.stateIds] } }) },
        }),
      ).resolves.toEqual({ OR: [{ AND: [{ OR: [] }] }] })
      return
    }

    const context = createBackendRequestContext(
      grantBackendPermission("project-space.list", [
        { type: "project-spaces", projectSpaceIds: ["cmissing"], recursive: true },
      ]),
    )
    await expect(
      buildBackendAuthorizationWhere({
        database,
        context,
        permission: "project-space.list",
        target: { projectSpaces: ids => ({ id: { in: [...ids] } }) },
      }),
    ).resolves.toEqual({ OR: [{ AND: [{ OR: [] }] }] })
  })
})

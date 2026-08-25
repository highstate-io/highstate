import { describe, expect, test } from "vitest"
import { PermissionDeniedError } from "../shared"
import {
  createBackendRequestContext,
  createProjectRequestContext,
  grantBackendPermission,
  grantProjectPermission,
} from "../test-utils"
import {
  hasBackendPermission,
  hasBackendPermissionSubset,
  hasProjectPermission,
  hasProjectPermissionSubset,
  requireBackendPermission,
  requireProjectPermission,
} from "./request-context"

describe("project request authorization", () => {
  test("allows a restricted permission subset but not a broader target", () => {
    const context = createProjectRequestContext(
      "project-1",
      grantProjectPermission("secret.list", [
        { type: "resources", resourceIds: ["secret-1", "secret-2"] },
      ]),
    )

    expect(
      hasProjectPermissionSubset(context, "secret.list", [
        { type: "resources", resourceIds: ["secret-1"] },
      ]),
    ).toBe(true)
    expect(
      hasProjectPermissionSubset(context, "secret.list", [
        { type: "resources", resourceIds: ["secret-3"] },
      ]),
    ).toBe(false)
    expect(hasProjectPermission(context, "secret.list", { resourceId: "secret-1" })).toBe(true)
  })

  test.each([
    ["resources", { type: "resources", resourceIds: ["resource-1"] }, { resourceId: "resource-1" }],
    [
      "instances",
      { type: "instances", instanceIds: ["component.v1:root"], recursive: false },
      { instanceId: "component.v1:root" },
    ],
    [
      "recursive instances",
      { type: "instances", instanceIds: ["component.v1:root"], recursive: true },
      { instanceId: "component.v1:child", ancestorInstanceIds: ["component.v1:root"] },
    ],
    [
      "owners",
      { type: "owners", serviceAccountIds: ["account-1"] },
      { ownerServiceAccountId: "account-1" },
    ],
    ["self", { type: "self" }, { ownerServiceAccountId: "account-1" }],
    ["workers", { type: "workers", workerIds: ["worker-1"] }, { workerId: "worker-1" }],
  ] as const)("matches the %s restriction only with its target field", (name, restriction, target) => {
    const context = createProjectRequestContext(
      "project-1",
      grantProjectPermission("secret.list", [restriction]),
      name === "self" ? { type: "service-account", serviceAccountId: "account-1" } : undefined,
    )

    expect(hasProjectPermission(context, "secret.list", target)).toBe(true)
    expect(hasProjectPermission(context, "secret.list", {})).toBe(false)
  })

  test("accepts an unrestricted permission", () => {
    const context = createProjectRequestContext("project-1", grantProjectPermission("page.list"))

    expect(hasProjectPermission(context, "page.list")).toBe(true)
  })

  test("evaluates every project restriction", () => {
    const serviceAccountContext = createProjectRequestContext(
      "project-1",
      grantProjectPermission("page.get", [{ type: "self" }]),
      { type: "service-account", serviceAccountId: "account-1" },
    )

    expect(
      hasProjectPermission(serviceAccountContext, "page.get", {
        resourceId: "page-1",
      }),
    ).toBe(false)

    const context = createProjectRequestContext(
      "project-1",
      grantProjectPermission("page.get", [
        { type: "resources", resourceIds: ["page-1"] },
        { type: "instances", instanceIds: ["example.v1:instance-1"], recursive: true },
        { type: "owners", serviceAccountIds: ["account-1"] },
        { type: "workers", workerIds: ["worker-1"] },
      ]),
    )

    expect(
      hasProjectPermission(context, "page.get", {
        resourceId: "page-1",
        instanceId: "example.v1:instance-1",
        ancestorInstanceIds: ["example.v1:root-instance"],
        ownerServiceAccountId: "account-1",
        workerId: "worker-1",
      }),
    ).toBe(true)

    const matchingContext = createProjectRequestContext(
      "project-1",
      grantProjectPermission("page.get", [
        { type: "resources", resourceIds: ["page-1"] },
        { type: "instances", instanceIds: ["example.v1:instance-1"], recursive: true },
        { type: "owners", serviceAccountIds: ["account-1"] },
        { type: "workers", workerIds: ["worker-1"] },
      ]),
      { type: "service-account", serviceAccountId: "account-1", workerId: "worker-1" },
    )

    expect(
      hasProjectPermission(matchingContext, "page.get", {
        resourceId: "page-1",
        instanceId: "example.v1:instance-1",
        ownerServiceAccountId: "account-1",
        workerId: "worker-1",
      }),
    ).toBe(true)

    expect(
      hasProjectPermission(matchingContext, "page.get", {
        resourceId: "page-2",
        instanceId: "example.v1:instance-1",
        ownerServiceAccountId: "account-1",
        workerId: "worker-1",
      }),
    ).toBe(false)

    expect(
      hasProjectPermission(matchingContext, "page.get", {
        resourceId: "page-1",
        instanceId: "example.v1:instance-2",
        ownerServiceAccountId: "account-1",
        workerId: "worker-1",
      }),
    ).toBe(false)

    expect(
      hasProjectPermission(matchingContext, "page.get", {
        resourceId: "page-1",
        instanceId: "example.v1:instance-1",
        ownerServiceAccountId: "account-2",
        workerId: "worker-1",
      }),
    ).toBe(false)

    expect(
      hasProjectPermission(matchingContext, "page.get", {
        resourceId: "page-1",
        instanceId: "example.v1:instance-1",
        ownerServiceAccountId: "account-1",
        workerId: "worker-2",
      }),
    ).toBe(false)
  })

  test("requires a service-account subject for self restrictions", () => {
    const context = createProjectRequestContext(
      "project-1",
      grantProjectPermission("page.get", [{ type: "self" }]),
    )

    expect(hasProjectPermission(context, "page.get", { ownerServiceAccountId: "account-1" })).toBe(
      false,
    )

    const serviceAccountContext = createProjectRequestContext(
      "project-1",
      grantProjectPermission("page.get", [{ type: "self" }]),
      { type: "service-account", serviceAccountId: "account-1" },
    )

    expect(
      hasProjectPermission(serviceAccountContext, "page.get", {
        ownerServiceAccountId: "account-1",
      }),
    ).toBe(true)
  })

  test("requires every restriction in a grant and accepts alternative grants", () => {
    const context = createProjectRequestContext(
      "project-1",
      grantProjectPermission("page.get", [
        { type: "resources", resourceIds: ["page-1"] },
        { type: "owners", serviceAccountIds: ["account-1"] },
      ]),
    )

    expect(
      hasProjectPermission(context, "page.get", {
        resourceId: "page-1",
        ownerServiceAccountId: "account-1",
      }),
    ).toBe(true)
    expect(
      hasProjectPermission(context, "page.get", {
        resourceId: "page-2",
        ownerServiceAccountId: "account-1",
      }),
    ).toBe(false)
  })

  test("rejects a missing permission", () => {
    const context = createProjectRequestContext("project-1", grantProjectPermission("page.get"))

    expect(() => requireProjectPermission(context, "page.list")).toThrow(PermissionDeniedError)
  })
})

describe("backend request authorization", () => {
  test("allows a restricted permission subset but not a broader target", () => {
    const context = createBackendRequestContext(
      grantBackendPermission("project.get", [
        { type: "projects", projectIds: ["project-1", "project-2"] },
      ]),
    )

    expect(
      hasBackendPermissionSubset(context, "project.get", [
        { type: "projects", projectIds: ["project-1"] },
      ]),
    ).toBe(true)
    expect(
      hasBackendPermissionSubset(context, "project.get", [
        { type: "projects", projectIds: ["project-3"] },
      ]),
    ).toBe(false)
  })

  test.each([
    ["resources", { type: "resources", resourceIds: ["resource-1"] }, { resourceId: "resource-1" }],
    ["projects", { type: "projects", projectIds: ["project-1"] }, { projectId: "project-1" }],
    [
      "project-spaces",
      { type: "project-spaces", projectSpaceIds: ["space-1"], recursive: false },
      { projectSpaceId: "space-1" },
    ],
    [
      "recursive project-spaces",
      { type: "project-spaces", projectSpaceIds: ["space-1"], recursive: true },
      { projectSpaceId: "space-2", ancestorProjectSpaceIds: ["space-1"] },
    ],
    [
      "projects-in-spaces",
      { type: "projects-in-spaces", projectSpaceIds: ["space-1"], recursive: false },
      { projectSpaceId: "space-1" },
    ],
    [
      "recursive projects-in-spaces",
      { type: "projects-in-spaces", projectSpaceIds: ["space-1"], recursive: true },
      { projectSpaceId: "space-2", ancestorProjectSpaceIds: ["space-1"] },
    ],
  ] as const)("matches the %s restriction only with its target field", (_name, restriction, target) => {
    const context = createBackendRequestContext(
      grantBackendPermission("project.list", [restriction]),
    )

    expect(hasBackendPermission(context, "project.list", target)).toBe(true)
    expect(hasBackendPermission(context, "project.list", {})).toBe(false)
  })

  test("evaluates every backend restriction", () => {
    const resourceContext = createBackendRequestContext(
      grantBackendPermission("project.get", [{ type: "resources", resourceIds: ["resource-1"] }]),
    )

    expect(hasBackendPermission(resourceContext, "project.get", { resourceId: "resource-1" })).toBe(
      true,
    )

    const context = createBackendRequestContext(
      grantBackendPermission("project.get", [
        { type: "projects", projectIds: ["project-1"] },
        { type: "project-spaces", projectSpaceIds: ["space-1"], recursive: true },
        { type: "projects-in-spaces", projectSpaceIds: ["space-1"], recursive: true },
      ]),
    )

    expect(
      hasBackendPermission(context, "project.get", {
        projectId: "project-2",
        projectSpaceId: "space-2",
        ancestorProjectSpaceIds: ["space-2"],
      }),
    ).toBe(false)

    const matchingContext = createBackendRequestContext(
      grantBackendPermission("project.get", [{ type: "projects", projectIds: ["project-1"] }]),
    )

    expect(hasBackendPermission(matchingContext, "project.get", { projectId: "project-1" })).toBe(
      true,
    )

    expect(hasBackendPermission(matchingContext, "project.get", { projectId: "project-2" })).toBe(
      false,
    )

    const projectSpaceContext = createBackendRequestContext(
      grantBackendPermission("project-space.get", [
        { type: "project-spaces", projectSpaceIds: ["space-1"], recursive: true },
      ]),
    )

    expect(
      hasBackendPermission(projectSpaceContext, "project-space.get", {
        projectSpaceId: "space-2",
        ancestorProjectSpaceIds: ["space-1"],
      }),
    ).toBe(true)

    expect(
      hasBackendPermission(projectSpaceContext, "project-space.get", {
        projectSpaceId: "space-2",
        ancestorProjectSpaceIds: [],
      }),
    ).toBe(false)
  })

  test("requires every restriction in a backend grant", () => {
    const context = createBackendRequestContext(
      grantBackendPermission("project.get", [
        { type: "projects", projectIds: ["project-1"] },
        { type: "projects-in-spaces", projectSpaceIds: ["space-1"], recursive: true },
      ]),
    )

    expect(
      hasBackendPermission(context, "project.get", {
        projectId: "project-1",
        projectSpaceId: "space-2",
        ancestorProjectSpaceIds: ["space-1"],
      }),
    ).toBe(true)
    expect(
      hasBackendPermission(context, "project.get", {
        projectId: "project-2",
        projectSpaceId: "space-2",
        ancestorProjectSpaceIds: ["space-1"],
      }),
    ).toBe(false)
  })

  test("evaluates recursive project space restrictions", () => {
    const context = createBackendRequestContext(
      grantBackendPermission("project-space.get", [
        { type: "project-spaces", projectSpaceIds: ["space-1"], recursive: true },
      ]),
    )

    expect(
      hasBackendPermission(context, "project-space.get", {
        projectSpaceId: "space-2",
        ancestorProjectSpaceIds: ["space-1"],
      }),
    ).toBe(true)
  })

  test("rejects a missing permission", () => {
    const context = createBackendRequestContext(grantBackendPermission("project.get"))

    expect(() => requireBackendPermission(context, "project.list")).toThrow(PermissionDeniedError)
  })
})

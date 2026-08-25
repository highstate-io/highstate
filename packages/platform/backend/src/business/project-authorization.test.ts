import type { DatabaseManager } from "../database"
import { describe, expect, test, vi } from "vitest"
import { resolveBackendProjectPermissionTarget } from "./project-authorization"

describe("resolveBackendProjectPermissionTarget", () => {
  test.each([
    {
      name: "returns the project space and ancestors",
      project: { spaceId: "space-child" },
      spaces: [
        { id: "space-root", parentId: null },
        { id: "space-parent", parentId: "space-root" },
        { id: "space-child", parentId: "space-parent" },
      ],
      expected: {
        projectId: "project-1",
        projectSpaceId: "space-child",
        ancestorProjectSpaceIds: ["space-parent", "space-root"],
      },
    },
    {
      name: "stops at a missing parent",
      project: { spaceId: "space-child" },
      spaces: [{ id: "space-child", parentId: "missing-space" }],
      expected: {
        projectId: "project-1",
        projectSpaceId: "space-child",
        ancestorProjectSpaceIds: [],
      },
    },
    {
      name: "stops on a cyclic parent chain",
      project: { spaceId: "space-a" },
      spaces: [
        { id: "space-a", parentId: "space-b" },
        { id: "space-b", parentId: "space-a" },
      ],
      expected: {
        projectId: "project-1",
        projectSpaceId: "space-a",
        ancestorProjectSpaceIds: ["space-b", "space-a"],
      },
    },
  ])("$name", async ({ project, spaces, expected }) => {
    const projectFindUnique = vi.fn().mockResolvedValue(project)
    const projectSpaceFindMany = vi.fn().mockResolvedValue(spaces)
    const database = {
      backend: {
        project: { findUnique: projectFindUnique },
        projectSpace: { findMany: projectSpaceFindMany },
      },
    } as unknown as DatabaseManager

    await expect(resolveBackendProjectPermissionTarget(database, "project-1")).resolves.toEqual(
      expected,
    )
  })

  test("returns only the project ID for an unknown project", async () => {
    const database = {
      backend: {
        project: { findUnique: vi.fn().mockResolvedValue(null) },
        projectSpace: { findMany: vi.fn() },
      },
    } as unknown as DatabaseManager

    await expect(
      resolveBackendProjectPermissionTarget(database, "missing-project"),
    ).resolves.toEqual({ projectId: "missing-project" })
  })
})

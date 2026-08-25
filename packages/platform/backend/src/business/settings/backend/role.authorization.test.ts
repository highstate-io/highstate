import type { BackendRoleInput } from "../../../shared"
import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import {
  adminBackendContext,
  createBackendRequestContext,
  grantBackendPermission,
  test,
} from "../../../test-utils"
import { BackendRoleSettingsService } from "./role"

describe("BackendRoleSettingsService authorization", () => {
  test("requires the minimal permission for every operation", async ({ database }) => {
    const service = new BackendRoleSettingsService(database)
    const input: BackendRoleInput = {
      meta: { title: "Role" },
      rules: [{ permissions: ["project.get"] }],
    }

    await expect(service.query(createBackendRequestContext(), { pageSize: 1 })).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(service.create(createBackendRequestContext(), input)).rejects.toThrow(
      PermissionDeniedError,
    )

    const role = await service.create(adminBackendContext(), input)
    await expect(service.get(createBackendRequestContext(), role.id)).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(service.update(createBackendRequestContext(), role.id, input)).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(service.delete(createBackendRequestContext(), role.id)).rejects.toThrow(
      PermissionDeniedError,
    )
  })

  test("requires unrestricted access or a matching resource restriction", async ({ database }) => {
    const service = new BackendRoleSettingsService(database)
    const role = await service.create(adminBackendContext(), {
      meta: { title: "Role" },
      rules: [{ permissions: ["project.get"] }],
    })
    const input: BackendRoleInput = {
      meta: { title: "Updated" },
      rules: [{ permissions: ["project.get"] }],
    }

    await expect(
      service.get(
        createBackendRequestContext(
          grantBackendPermission("role.get", [{ type: "resources", resourceIds: ["other"] }]),
        ),
        role.id,
      ),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.get(
        createBackendRequestContext(
          grantBackendPermission("role.get", [{ type: "resources", resourceIds: [role.id] }]),
        ),
        role.id,
      ),
    ).resolves.toMatchObject({ id: role.id })

    await expect(
      service.update(
        createBackendRequestContext(
          grantBackendPermission("role.update", [{ type: "resources", resourceIds: [role.id] }]),
        ),
        role.id,
        input,
      ),
    ).rejects.toThrow(PermissionDeniedError)
  })

  test("allows creating a role that is within the caller's permissions", async ({ database }) => {
    const service = new BackendRoleSettingsService(database)
    const context = createBackendRequestContext(
      new Map([
        ["role.create", [{ restrictions: [] }]],
        ["project.get", [{ restrictions: [] }]],
      ]),
    )

    await expect(
      service.create(context, {
        meta: { title: "Subset" },
        rules: [{ permissions: ["project.get"] }],
      }),
    ).resolves.toMatchObject({ meta: { title: "Subset" } })
  })

  test("requires role escalation for a broader role", async ({ database }) => {
    const service = new BackendRoleSettingsService(database)
    const context = createBackendRequestContext(
      new Map([
        ["role.create", [{ restrictions: [] }]],
        ["project.get", [{ restrictions: [] }]],
      ]),
    )

    await expect(
      service.create(context, {
        meta: { title: "Escalated" },
        rules: [{ permissions: ["project.create"] }],
      }),
    ).rejects.toThrow(PermissionDeniedError)
  })

  test("filters role collections by resource restrictions", async ({ database }) => {
    const service = new BackendRoleSettingsService(database)
    const first = await service.create(adminBackendContext(), {
      meta: { title: "First" },
      rules: [{ permissions: ["project.get"] }],
    })
    const second = await service.create(adminBackendContext(), {
      meta: { title: "Second" },
      rules: [{ permissions: ["project.get"] }],
    })

    await expect(
      service.query(
        createBackendRequestContext(
          grantBackendPermission("role.list", [{ type: "resources", resourceIds: [first.id] }]),
        ),
        { pageSize: 10 },
      ),
    ).resolves.toMatchObject({ items: [{ id: first.id }] })

    expect(first.id).not.toBe(second.id)
  })

  test("filters restriction options by each resource permission", async ({ database }) => {
    const service = new BackendRoleSettingsService(database)
    const first = await service.create(adminBackendContext(), {
      meta: { title: "Visible" },
      rules: [{ permissions: ["project.get"] }],
    })
    const second = await service.create(adminBackendContext(), {
      meta: { title: "Hidden" },
      rules: [{ permissions: ["project.get"] }],
    })

    const options = await service.getRestrictionOptions(
      createBackendRequestContext(
        new Map([
          ["role.get", [{ restrictions: [] }]],
          ["role.list", [{ restrictions: [{ type: "resources", resourceIds: [first.id] }] }]],
        ]),
      ),
    )

    expect(options.resources["backend-role"]).toEqual([expect.objectContaining({ id: first.id })])
    expect(options.resources["backend-role"]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: second.id })]),
    )
  })
})

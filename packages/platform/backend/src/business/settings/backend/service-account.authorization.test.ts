import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import {
  adminBackendContext,
  createBackendRequestContext,
  grantBackendPermission,
  test,
} from "../../../test-utils"
import { BackendRoleSettingsService } from "./role"
import { BackendServiceAccountSettingsService } from "./service-account"

describe("BackendServiceAccountSettingsService authorization", () => {
  test("requires service-account.list for collection access", async ({ database }) => {
    const service = new BackendServiceAccountSettingsService(database, {} as never, {} as never)

    await expect(service.query(createBackendRequestContext(), { pageSize: 1 })).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(
      service.query(createBackendRequestContext(grantBackendPermission("service-account.list")), {
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ items: [{ systemName: "admin" }] })
  })

  test("requires permissions for every service-account operation", async ({ database }) => {
    const service = new BackendServiceAccountSettingsService(database, {} as never, {} as never)
    const context = createBackendRequestContext()

    await expect(service.get(context, "missing")).resolves.toBeNull()

    await expect(service.create(context, { meta: { title: "Account" } })).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(
      service.update(context, "missing", { meta: { title: "Account" } }),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(service.delete(context, "missing")).rejects.toThrow(PermissionDeniedError)
    await expect(service.getRoleBindings(context, "missing")).rejects.toThrow(PermissionDeniedError)
    await expect(service.getRoleBindingsByRole(context, "missing")).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(service.addRoleBinding(context, "missing", "missing")).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(service.removeRoleBinding(context, "missing", "missing")).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(service.getProjectBindingOptions(context, "missing")).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(service.setProjectBinding(context, "missing", "missing", null)).rejects.toThrow(
      PermissionDeniedError,
    )
  })

  test("allows binding a role within the caller's permissions", async ({ database }) => {
    const roles = new BackendRoleSettingsService(database)
    const service = new BackendServiceAccountSettingsService(database, {} as never, roles)
    const unrestricted = adminBackendContext()
    const role = await roles.create(unrestricted, {
      meta: { title: "Subset" },
      rules: [{ permissions: ["project.get"] }],
    })
    const account = await service.create(unrestricted, { meta: { title: "Automation" } })

    await expect(
      service.addRoleBinding(
        createBackendRequestContext(
          new Map([
            ["role-binding.create", [{ restrictions: [] }]],
            ["project.get", [{ restrictions: [] }]],
          ]),
        ),
        role.id,
        account.id,
      ),
    ).resolves.toBeUndefined()
  })

  test("requires access to the requested principal for role-binding queries", async ({
    database,
  }) => {
    const roles = new BackendRoleSettingsService(database)
    const service = new BackendServiceAccountSettingsService(database, {} as never, roles)
    const admin = adminBackendContext()
    const role = await roles.create(admin, {
      meta: { title: "Role" },
      rules: [{ permissions: ["project.get"] }],
    })
    const account = await service.create(admin, { meta: { title: "Account" } })
    const context = createBackendRequestContext(grantBackendPermission("role-binding.list"))

    await expect(service.getRoleBindings(context, account.id)).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(service.getRoleBindingsByRole(context, role.id)).rejects.toThrow(
      PermissionDeniedError,
    )
  })
})

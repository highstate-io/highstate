import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import {
  adminProjectContext,
  createProjectRequestContext,
  grantProjectPermission,
  test,
} from "../../../test-utils"
import { ProjectRoleSettingsService } from "./role"
import { ProjectServiceAccountSettingsService } from "./service-account"

describe("ProjectServiceAccountSettingsService authorization", () => {
  test("requires service-account.list", async ({ database, project }) => {
    const service = new ProjectServiceAccountSettingsService(database, {} as never)

    await expect(
      service.query(createProjectRequestContext(project.id), { pageSize: 1 }),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.query(
        createProjectRequestContext(project.id, grantProjectPermission("service-account.list")),
        { pageSize: 1 },
      ),
    ).resolves.toMatchObject({ items: [{ systemName: "admin" }] })
  })

  test("allows binding a role within the caller's permissions", async ({ database, project }) => {
    const roles = new ProjectRoleSettingsService(database)
    const service = new ProjectServiceAccountSettingsService(database, roles)
    const admin = createProjectRequestContext(project.id)
    const unrestricted = adminProjectContext(project.id)
    const role = await roles.create(unrestricted, {
      meta: { title: "Subset" },
      rules: [{ permissions: ["instance-model.get"] }],
    })
    const account = await service.create(unrestricted, { meta: { title: "Automation" } })

    await expect(
      service.addRoleBinding(
        {
          ...admin,
          permissions: grantProjectPermission("role-binding.create"),
        },
        role.id,
        account.id,
      ),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(
      service.addRoleBinding(
        {
          ...admin,
          permissions: new Map([
            ["role-binding.create", [{ restrictions: [] }]],
            ["instance-model.get", [{ restrictions: [] }]],
          ]),
        },
        role.id,
        account.id,
      ),
    ).resolves.toBeUndefined()
  })

  test("requires access to the requested principal for role-binding queries", async ({
    database,
    project,
  }) => {
    const roles = new ProjectRoleSettingsService(database)
    const service = new ProjectServiceAccountSettingsService(database, roles)
    const admin = adminProjectContext(project.id)
    const role = await roles.create(admin, {
      meta: { title: "Role" },
      rules: [{ permissions: ["instance-model.get"] }],
    })
    const account = await service.create(admin, { meta: { title: "Account" } })
    const context = createProjectRequestContext(
      project.id,
      grantProjectPermission("role-binding.list"),
    )

    await expect(service.getRoleBindings(context, account.id)).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(service.getRoleBindingsByRole(context, role.id)).rejects.toThrow(
      PermissionDeniedError,
    )
  })
})

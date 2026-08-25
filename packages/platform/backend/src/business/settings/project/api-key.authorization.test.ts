import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import {
  adminProjectContext,
  createProjectRequestContext,
  grantProjectPermission,
  test,
} from "../../../test-utils"
import { ProjectApiKeySettingsService } from "./api-key"
import { ProjectRoleSettingsService } from "./role"
import { ProjectServiceAccountSettingsService } from "./service-account"

describe("ProjectApiKeySettingsService authorization", () => {
  test("requires api-key.list", async ({ database, project }) => {
    const service = new ProjectApiKeySettingsService(database, {} as never, {} as never)

    await expect(
      service.query(createProjectRequestContext(project.id), { pageSize: 1 }),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.query(
        createProjectRequestContext(project.id, grantProjectPermission("api-key.list")),
        { pageSize: 1 },
      ),
    ).resolves.toMatchObject({ items: [] })
  })

  test("requires permissions for API-key reads and writes", async ({ database, project }) => {
    const service = new ProjectApiKeySettingsService(database, {} as never, {} as never)
    const context = createProjectRequestContext(project.id)

    await expect(service.get(context, "missing")).resolves.toBeNull()
    await expect(
      service.create(context, {
        meta: { title: "Key" },
        restrictionRules: [],
        expiresAt: null,
      }),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.update(context, "missing", {
        meta: { title: "Key" },
        restrictionRules: [],
        expiresAt: null,
      }),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(service.delete(context, "missing")).rejects.toThrow(PermissionDeniedError)
    await expect(service.getServiceAccountOptions(context)).rejects.toThrow(PermissionDeniedError)
  })

  test("does not require escalation for a permission-rule subset", async ({
    database,
    project,
  }) => {
    const roles = new ProjectRoleSettingsService(database)
    const accounts = new ProjectServiceAccountSettingsService(database, roles)
    const service = new ProjectApiKeySettingsService(database, roles, accounts)
    const adminContext = adminProjectContext(project.id)
    const role = await roles.create(adminContext, {
      meta: { title: "Key role" },
      rules: [{ permissions: ["instance-model.get"] }],
    })
    const account = await accounts.create(adminContext, { meta: { title: "Key account" } })
    await accounts.addRoleBinding(adminContext, role.id, account.id)
    const input = {
      meta: { title: "Key" },
      serviceAccountId: account.id,
      restrictionRules: [],
      expiresAt: null,
    }
    const created = await service.create(
      createProjectRequestContext(
        project.id,
        new Map([
          ["api-key.create", [{ restrictions: [] }]],
          ["instance-model.get", [{ restrictions: [] }]],
        ]),
      ),
      input,
    )

    await expect(
      service.update(
        createProjectRequestContext(
          project.id,
          new Map([
            [
              "api-key.update",
              [{ restrictions: [{ type: "resources", resourceIds: [created.apiKey.id] }] }],
            ],
            ["instance-model.get", [{ restrictions: [] }]],
          ]),
        ),
        created.apiKey.id,
        input,
      ),
    ).resolves.toMatchObject({ id: created.apiKey.id })
  })
})

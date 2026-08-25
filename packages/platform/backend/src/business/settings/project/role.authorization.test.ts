import type { ProjectRoleInput } from "../../../shared"
import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import {
  adminProjectContext,
  createProjectRequestContext,
  grantProjectPermission,
  test,
} from "../../../test-utils"
import { ProjectRoleSettingsService } from "./role"

describe("ProjectRoleSettingsService authorization", () => {
  test("requires the minimal permission for every operation", async ({ database, project }) => {
    const service = new ProjectRoleSettingsService(database)
    const input: ProjectRoleInput = {
      meta: { title: "Role" },
      rules: [{ permissions: ["instance-model.get"] }],
    }

    await expect(
      service.query(createProjectRequestContext(project.id), { pageSize: 1 }),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(service.create(createProjectRequestContext(project.id), input)).rejects.toThrow(
      PermissionDeniedError,
    )

    const role = await service.create(adminProjectContext(project.id), input)
    await expect(service.get(createProjectRequestContext(project.id), role.id)).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(
      service.update(createProjectRequestContext(project.id), role.id, input),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(service.delete(createProjectRequestContext(project.id), role.id)).rejects.toThrow(
      PermissionDeniedError,
    )
  })

  test("enforces resource restrictions on role reads", async ({ database, project }) => {
    const service = new ProjectRoleSettingsService(database)
    const role = await service.create(adminProjectContext(project.id), {
      meta: { title: "Role" },
      rules: [{ permissions: ["instance-model.get"] }],
    })

    await expect(
      service.get(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("role.get", [{ type: "resources", resourceIds: ["other"] }]),
        ),
        role.id,
      ),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(
      service.get(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("role.get", [{ type: "resources", resourceIds: [role.id] }]),
        ),
        role.id,
      ),
    ).resolves.toMatchObject({ id: role.id })
  })

  test("does not mutate a role when escalation is denied", async ({ database, project }) => {
    const service = new ProjectRoleSettingsService(database)
    const role = await service.create(adminProjectContext(project.id), {
      meta: { title: "Original" },
      rules: [{ permissions: ["instance-model.get"] }],
    })

    await expect(
      service.update(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("role.update", [{ type: "resources", resourceIds: [role.id] }]),
        ),
        role.id,
        { meta: { title: "Changed" }, rules: [{ permissions: ["instance-model.get"] }] },
      ),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(service.get(adminProjectContext(project.id), role.id)).resolves.toMatchObject({
      meta: { title: "Original" },
    })
  })

  test("allows creating a role that is within the caller's permissions", async ({
    database,
    project,
  }) => {
    const service = new ProjectRoleSettingsService(database)
    const context = createProjectRequestContext(
      project.id,
      new Map([
        ["role.create", [{ restrictions: [] }]],
        ["instance-model.get", [{ restrictions: [] }]],
      ]),
    )

    await expect(
      service.create(context, {
        meta: { title: "Subset" },
        rules: [{ permissions: ["instance-model.get"] }],
      }),
    ).resolves.toMatchObject({ meta: { title: "Subset" } })
  })

  test("requires role escalation for a broader role", async ({ database, project }) => {
    const service = new ProjectRoleSettingsService(database)
    const context = createProjectRequestContext(
      project.id,
      new Map([
        ["role.create", [{ restrictions: [] }]],
        ["instance-model.get", [{ restrictions: [] }]],
      ]),
    )

    await expect(
      service.create(context, {
        meta: { title: "Escalated" },
        rules: [{ permissions: ["secret.value.get"] }],
      }),
    ).rejects.toThrow(PermissionDeniedError)
  })

  test("filters role collections by resource restrictions", async ({ database, project }) => {
    const service = new ProjectRoleSettingsService(database)
    const first = await service.create(adminProjectContext(project.id), {
      meta: { title: "First" },
      rules: [{ permissions: ["instance-model.get"] }],
    })
    const second = await service.create(adminProjectContext(project.id), {
      meta: { title: "Second" },
      rules: [{ permissions: ["instance-model.get"] }],
    })

    await expect(
      service.query(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("role.list", [{ type: "resources", resourceIds: [first.id] }]),
        ),
        { pageSize: 10 },
      ),
    ).resolves.toMatchObject({ items: [{ id: first.id }] })

    expect(first.id).not.toBe(second.id)
  })

  test("requires role.get for restriction options", async ({ database, project }) => {
    const service = new ProjectRoleSettingsService(database)

    await expect(
      service.getRestrictionOptions(createProjectRequestContext(project.id)),
    ).rejects.toThrow(PermissionDeniedError)
  })

  test("filters restriction options by each resource permission", async ({ database, project }) => {
    const service = new ProjectRoleSettingsService(database)
    const admin = adminProjectContext(project.id)
    const role = await service.create(admin, {
      meta: { title: "Visible" },
      rules: [{ permissions: ["instance-model.get"] }],
    })
    const account = await database
      .forProject(project.id)
      .then(db => db.serviceAccount.create({ data: { meta: { title: "Hidden account" } } }))

    const options = await service.getRestrictionOptions(
      createProjectRequestContext(
        project.id,
        new Map([
          ["role.get", [{ restrictions: [] }]],
          ["role.list", [{ restrictions: [{ type: "resources", resourceIds: [role.id] }] }]],
          ["service-account.list", [{ restrictions: [{ type: "resources", resourceIds: [] }] }]],
        ]),
      ),
    )

    expect(options.resources.role).toEqual([{ id: role.id, title: "Visible" }])
    expect(options.serviceAccounts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: account.id })]),
    )
  })
})

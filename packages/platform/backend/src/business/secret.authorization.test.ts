import { describe, expect } from "vitest"
import { PermissionDeniedError, SecretNotEditableError, SecretNotFoundError } from "../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../test-utils"
import { SecretService } from "./secret"

describe("SecretService authorization", () => {
  test("checks resource-scoped update permission and rejects unmanaged edits", async ({
    database,
    project,
    projectDatabase,
    createInstanceState,
  }) => {
    const service = new SecretService(database, {} as never, {} as never, {} as never, {} as never)
    const state = await createInstanceState(project.id)

    const secret = await projectDatabase.secret.create({
      data: { stateId: state.id, name: "token", meta: { title: "Token" }, content: "unchanged" },
    })

    for (const context of [
      createProjectRequestContext(project.id),
      createProjectRequestContext(
        project.id,
        grantProjectPermission("secret.update", [{ type: "resources", resourceIds: ["other"] }]),
      ),
    ]) {
      await expect(service.updateSecretContent(context, secret.id, "new")).rejects.toThrow(
        PermissionDeniedError,
      )
    }

    expect(
      await projectDatabase.secret.findUniqueOrThrow({ where: { id: secret.id } }),
    ).toMatchObject({ content: "unchanged" })

    const context = createProjectRequestContext(project.id, grantProjectPermission("secret.update"))

    await expect(service.updateSecretContent(context, "missing", "new")).rejects.toThrow(
      SecretNotFoundError,
    )

    const systemSecret = await projectDatabase.secret.create({
      data: { systemName: "system", meta: { title: "System" }, content: "private" },
    })

    await expect(service.updateSecretContent(context, systemSecret.id, "new")).rejects.toThrow(
      SecretNotEditableError,
    )

    expect(
      await projectDatabase.secret.findUniqueOrThrow({ where: { id: systemSecret.id } }),
    ).toMatchObject({ content: "private" })
  })

  test("requires secret permissions before secret operations", async ({
    database,
    project,
    createInstanceState,
  }) => {
    const service = new SecretService(database, {} as never, {} as never, {} as never, {} as never)
    const state = await createInstanceState(project.id)

    await expect(
      service.getInstanceSecretValues(createProjectRequestContext(project.id), state.id),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(
      service.updateInstanceSecrets(createProjectRequestContext(project.id), state.id, {}),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(
      service.getInstanceSecretValues(
        createProjectRequestContext(project.id, grantProjectPermission("secret.value.get")),
        state.id,
      ),
    ).resolves.toEqual({})
  })
})

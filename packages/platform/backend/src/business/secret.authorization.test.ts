import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../test-utils"
import { SecretService } from "./secret"

describe("SecretService authorization", () => {
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

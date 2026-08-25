import { describe, expect } from "vitest"
import { test } from "../test-utils"
import {
  ApiKeyService,
  hashApiKeyToken,
  rotateBackendApiKeyToken,
  rotateProjectApiKeyToken,
} from "./api-key"

describe("API key token rotation", () => {
  test("rotates a project API key with a locatable token", async ({ database, project }) => {
    const projectDatabase = await database.forProject(project.id)
    const serviceAccount = await projectDatabase.serviceAccount.create({
      data: { meta: { title: "API key account" } },
    })
    const apiKey = await projectDatabase.apiKey.create({
      data: { meta: { title: "API key" }, serviceAccountId: serviceAccount.id },
    })
    const { token } = await rotateProjectApiKeyToken(projectDatabase, apiKey.id)

    expect(token).toMatch(new RegExp(`^hcp_${apiKey.id}_[a-z][0-9a-z]{23}$`))
  })

  test("rotates a backend API key with a locatable token", async ({ database }) => {
    const serviceAccount = await database.backend.backendServiceAccount.create({
      data: { meta: { title: "API key account" } },
    })
    const apiKey = await database.backend.backendApiKey.create({
      data: { meta: { title: "API key" }, serviceAccountId: serviceAccount.id },
    })
    const { token } = await rotateBackendApiKeyToken(database.backend, apiKey.id)

    expect(token).toMatch(new RegExp(`^hcb_${apiKey.id}_[a-z][0-9a-z]{23}$`))
  })

  test("authenticates a backend API key token", async ({ database, logger }) => {
    const serviceAccount = await database.backend.backendServiceAccount.create({
      data: { meta: { title: "API key account" } },
    })
    const apiKey = await database.backend.backendApiKey.create({
      data: { meta: { title: "API key" }, serviceAccountId: serviceAccount.id },
    })
    const { token } = await rotateBackendApiKeyToken(database.backend, apiKey.id)
    const service = new ApiKeyService(database, logger)

    await expect(service.getBackendApiKeyByToken(token)).resolves.toEqual({
      id: apiKey.id,
      serviceAccountId: serviceAccount.id,
      restrictionRules: [],
    })

    const updated = await database.backend.backendApiKey.findUniqueOrThrow({
      where: { id: apiKey.id },
    })
    expect(updated.lastUsedAt).not.toBeNull()
  })

  test("rejects expired keys without updating lastUsedAt", async ({ database, logger }) => {
    const serviceAccount = await database.backend.backendServiceAccount.create({
      data: { meta: { title: "Expired API key account" } },
    })
    const service = new ApiKeyService(database, logger)

    for (const expiresAt of [new Date(0), new Date()]) {
      const apiKey = await database.backend.backendApiKey.create({
        data: {
          meta: { title: "Expired API key" },
          serviceAccountId: serviceAccount.id,
          expiresAt,
        },
      })
      const { token } = await rotateBackendApiKeyToken(database.backend, apiKey.id)

      await expect(service.getBackendApiKeyByToken(token)).rejects.toThrow()
      const unchanged = await database.backend.backendApiKey.findUniqueOrThrow({
        where: { id: apiKey.id },
      })
      expect(unchanged.lastUsedAt).toBeNull()
    }
  })

  test("invalidates the old backend token immediately after rotation", async ({
    database,
    logger,
  }) => {
    const serviceAccount = await database.backend.backendServiceAccount.create({
      data: { meta: { title: "API key account" } },
    })
    const apiKey = await database.backend.backendApiKey.create({
      data: { meta: { title: "API key" }, serviceAccountId: serviceAccount.id },
    })
    const first = await rotateBackendApiKeyToken(database.backend, apiKey.id)
    const service = new ApiKeyService(database, logger)
    const second = await rotateBackendApiKeyToken(database.backend, apiKey.id)

    await expect(service.getBackendApiKeyByToken(first.token)).rejects.toThrow(
      'Credential of type "backend-api-key" is invalid',
    )
    await expect(service.getBackendApiKeyByToken(second.token)).resolves.toEqual({
      id: apiKey.id,
      serviceAccountId: serviceAccount.id,
      restrictionRules: [],
    })
  })

  test("rejects deleted, expired, and boundary-expired backend API keys", async ({
    database,
    logger,
  }) => {
    const serviceAccount = await database.backend.backendServiceAccount.create({
      data: { meta: { title: "API key account" } },
    })
    const service = new ApiKeyService(database, logger)

    for (const expiresAt of [new Date(Date.now() - 1), new Date()]) {
      const apiKey = await database.backend.backendApiKey.create({
        data: { meta: { title: "API key" }, serviceAccountId: serviceAccount.id, expiresAt },
      })
      const { token } = await rotateBackendApiKeyToken(database.backend, apiKey.id)

      await expect(service.getBackendApiKeyByToken(token)).rejects.toThrow(
        'Credential of type "backend-api-key" is invalid',
      )
    }

    const deletedApiKey = await database.backend.backendApiKey.create({
      data: { meta: { title: "API key" }, serviceAccountId: serviceAccount.id },
    })
    const { token } = await rotateBackendApiKeyToken(database.backend, deletedApiKey.id)
    await database.backend.backendApiKey.delete({ where: { id: deletedApiKey.id } })
    await expect(service.getBackendApiKeyByToken(token)).rejects.toThrow(
      'Credential of type "backend-api-key" is invalid',
    )
  })

  test("rejects a valid ID with the wrong hash without updating lastUsedAt", async ({
    database,
    logger,
  }) => {
    const serviceAccount = await database.backend.backendServiceAccount.create({
      data: { meta: { title: "API key account" } },
    })
    const apiKey = await database.backend.backendApiKey.create({
      data: { meta: { title: "API key" }, serviceAccountId: serviceAccount.id },
    })
    const { token } = await rotateBackendApiKeyToken(database.backend, apiKey.id)
    const service = new ApiKeyService(database, logger)

    await database.backend.backendApiKey.update({
      where: { id: apiKey.id },
      data: { tokenHash: hashApiKeyToken(`${token}-wrong`) },
    })
    await expect(service.getBackendApiKeyByToken(token)).rejects.toThrow()

    const unchanged = await database.backend.backendApiKey.findUniqueOrThrow({
      where: { id: apiKey.id },
    })
    expect(unchanged.lastUsedAt).toBeNull()
  })

  test("rejects malformed and invalid backend tokens without updating any key", async ({
    database,
    logger,
  }) => {
    const service = new ApiKeyService(database, logger)
    const usedBefore = await database.backend.backendApiKey.count({
      where: { lastUsedAt: { not: null } },
    })

    for (const token of [
      "",
      "hcb_invalid",
      "hcb_01h000000000000000000000_01h000000000000000000000",
    ]) {
      await expect(service.getBackendApiKeyByToken(token)).rejects.toThrow()
    }
    expect(
      await database.backend.backendApiKey.count({ where: { lastUsedAt: { not: null } } }),
    ).toBe(usedBefore)
  })

  test("returns plaintext only from rotation and never as ordinary key data", async ({
    database,
    logger,
  }) => {
    const serviceAccount = await database.backend.backendServiceAccount.create({
      data: { meta: { title: "API key account" } },
    })
    const apiKey = await database.backend.backendApiKey.create({
      data: { meta: { title: "API key" }, serviceAccountId: serviceAccount.id },
    })
    const { token } = await rotateBackendApiKeyToken(database.backend, apiKey.id)
    const service = new ApiKeyService(database, logger)
    const authenticated = await service.getBackendApiKeyByToken(token)

    expect(JSON.stringify(authenticated)).not.toContain(token)
    expect(token).toMatch(new RegExp(`^hcb_${apiKey.id}_[a-z][0-9a-z]{23}$`))
  })

  test("rejects API key tokens from the wrong realm", async ({ database, logger, project }) => {
    const projectDatabase = await database.forProject(project.id)
    const projectAccount = await projectDatabase.serviceAccount.create({
      data: { meta: { title: "Project account" } },
    })
    const projectKey = await projectDatabase.apiKey.create({
      data: { meta: { title: "Project key" }, serviceAccountId: projectAccount.id },
    })
    const { token: projectToken } = await rotateProjectApiKeyToken(projectDatabase, projectKey.id)

    const backendAccount = await database.backend.backendServiceAccount.create({
      data: { meta: { title: "Backend account" } },
    })
    const backendKey = await database.backend.backendApiKey.create({
      data: { meta: { title: "Backend key" }, serviceAccountId: backendAccount.id },
    })
    const { token: backendToken } = await rotateBackendApiKeyToken(database.backend, backendKey.id)
    const service = new ApiKeyService(database, logger)

    await expect(service.getBackendApiKeyByToken(projectToken)).rejects.toThrow()
    await expect(service.getApiKeyByToken(project.id, backendToken)).rejects.toThrow()
  })

  test("authenticates a backend API key as its bound project service account", async ({
    database,
    logger,
    project,
  }) => {
    const projectDatabase = await database.forProject(project.id)
    const projectAccount = await projectDatabase.serviceAccount.create({
      data: { meta: { title: "Project account" } },
    })
    const backendAccount = await database.backend.backendServiceAccount.create({
      data: { meta: { title: "Backend account" } },
    })
    const backendKey = await database.backend.backendApiKey.create({
      data: { meta: { title: "Backend key" }, serviceAccountId: backendAccount.id },
    })
    await database.backend.backendServiceAccountProjectBinding.create({
      data: {
        backendServiceAccountId: backendAccount.id,
        projectId: project.id,
        projectServiceAccountId: projectAccount.id,
      },
    })
    const { token } = await rotateBackendApiKeyToken(database.backend, backendKey.id)
    const service = new ApiKeyService(database, logger)

    await expect(service.getProjectCredentialByToken(project.id, token)).resolves.toEqual({
      id: backendKey.id,
      serviceAccountId: projectAccount.id,
      restrictionRules: [],
    })
  })

  test("rejects a backend API key without a project binding", async ({
    database,
    logger,
    project,
  }) => {
    const backendAccount = await database.backend.backendServiceAccount.create({
      data: { meta: { title: "Backend account" } },
    })
    const backendKey = await database.backend.backendApiKey.create({
      data: { meta: { title: "Backend key" }, serviceAccountId: backendAccount.id },
    })
    const { token } = await rotateBackendApiKeyToken(database.backend, backendKey.id)
    const service = new ApiKeyService(database, logger)

    await expect(service.getProjectCredentialByToken(project.id, token)).rejects.toThrow(
      "API key is not valid for the requested project",
    )
  })
})

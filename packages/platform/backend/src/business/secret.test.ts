import type { LibraryBackend } from "../library"
import type { PubSubManager } from "../pubsub"
import { defineEntity, defineUnit, z } from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"
import { describe, vi } from "vitest"
import { InstanceStateNotFoundError, InvalidInstanceKindError, SystemSecretNames } from "../shared"
import { test } from "../test-utils"
import { SecretService } from "./secret"

const secretTest = test.extend<{
  pubsubManager: PubSubManager
  libraryBackend: LibraryBackend
  secretService: SecretService
}>({
  pubsubManager: async ({}, use) => {
    const pubsubManager = vi.mockObject({
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      publishMany: vi.fn().mockResolvedValue(undefined),
    } as unknown as PubSubManager)

    await use(pubsubManager)
  },

  libraryBackend: async ({}, use) => {
    // create test entity
    const testEntity = defineEntity({
      type: "test.entity.v1",
      schema: z.object({
        value: z.string(),
      }),
    })

    // create test unit with secrets
    const testUnit = defineUnit({
      type: "component.v1",
      inputs: {
        dependency: testEntity,
      },
      secrets: {
        "api-key": {
          schema: z.string(),
          meta: {
            title: "API Key",
            description: "Authentication key for external service access",
            icon: "mdi:key",
          },
        },
        password: {
          schema: z.string(),
          meta: {
            title: "Database Password",
            description: "Secure password for database connections",
            icon: "mdi:database-lock",
          },
        },
        "existing-key": {
          schema: z.string(),
          meta: {
            title: "Existing Configuration Key",
            description: "Legacy configuration key maintained for compatibility",
            icon: "mdi:cog",
          },
        },
        "new-key": {
          schema: z.string(),
          meta: {
            title: "New Access Token",
            description: "Newly generated access token for service authentication",
            icon: "mdi:shield-key",
          },
        },
      },
      source: {
        package: "@test/units",
        path: "test-unit",
      },
    })

    const library = {
      components: {
        "component.v1": testUnit.model,
      },
      entities: {
        "test.entity.v1": testEntity.model,
      },
    }

    const libraryBackend = vi.mocked({
      loadLibrary: vi.fn().mockResolvedValue(library),
      getResolvedUnitSources: vi.fn(),
    } as unknown as LibraryBackend)

    await use(libraryBackend)
  },

  secretService: async ({ database, pubsubManager, libraryBackend, logger }, use) => {
    const service = new SecretService(
      database,
      pubsubManager,
      libraryBackend,
      logger.child({ service: "SecretService" }),
    )

    await use(service)
  },
})

describe("updateInstanceSecrets", () => {
  secretTest(
    "creates new secrets for unit instance",
    async ({ secretService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)

      const changedSecrets = {
        "api-key": "secret-api-key",
        password: "secret-password",
      }

      // act
      await secretService.updateInstanceSecrets(project.id, instance.id, changedSecrets)

      // assert
      const secrets = await projectDatabase.secret.findMany({
        where: { stateId: instance.id },
      })
      expect(secrets).toHaveLength(2)

      const apiKeySecret = secrets.find(s => s.name === "api-key")
      expect(apiKeySecret).toBeDefined()
      expect(apiKeySecret?.content).toBe("secret-api-key")
      expect(apiKeySecret?.meta).toEqual({
        title: "API Key",
        description: "Authentication key for external service access",
        icon: "mdi:key",
      })

      const passwordSecret = secrets.find(s => s.name === "password")
      expect(passwordSecret).toBeDefined()
      expect(passwordSecret?.content).toBe("secret-password")
      expect(passwordSecret?.meta).toEqual({
        title: "Database Password",
        description: "Secure password for database connections",
        icon: "mdi:database-lock",
      })
    },
  )

  secretTest(
    "updates existing secrets for unit instance",
    async ({ secretService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)

      // create existing secret
      await projectDatabase.secret.create({
        data: {
          id: createId(),
          stateId: instance.id,
          name: "api-key",
          meta: { title: "Old Title", description: "Old description" },
          content: "old-value",
        },
      })

      const changedSecrets = {
        "api-key": "new-secret-value",
      }

      // act
      await secretService.updateInstanceSecrets(project.id, instance.id, changedSecrets)

      // assert
      const secrets = await projectDatabase.secret.findMany({
        where: { stateId: instance.id },
      })
      expect(secrets).toHaveLength(1)
      expect(secrets[0].content).toBe("new-secret-value")
      expect(secrets[0].meta).toEqual({
        title: "API Key",
        description: "Authentication key for external service access",
        icon: "mdi:key",
      })
    },
  )

  secretTest(
    "preserves existing secrets when called with empty object",
    async ({ secretService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)

      // create existing secrets
      await projectDatabase.secret.createMany({
        data: [
          {
            id: createId(),
            stateId: instance.id,
            name: "api-key",
            meta: { title: "API Key" },
            content: "secret-1",
          },
          {
            id: createId(),
            stateId: instance.id,
            name: "password",
            meta: { title: "Password" },
            content: "secret-2",
          },
        ],
      })

      // act
      await secretService.updateInstanceSecrets(project.id, instance.id, {})

      // assert
      const secrets = await projectDatabase.secret.findMany({
        where: { stateId: instance.id },
      })
      expect(secrets).toHaveLength(2)
    },
  )

  secretTest(
    "handles mixed create and update operations while preserving existing secrets",
    async ({ secretService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)

      // create existing secrets
      await projectDatabase.secret.createMany({
        data: [
          {
            id: createId(),
            stateId: instance.id,
            name: "existing-key",
            meta: { title: "Existing" },
            content: "old-value",
          },
          {
            id: createId(),
            stateId: instance.id,
            name: "to-preserve",
            meta: { title: "To Preserve" },
            content: "preserve-me",
          },
        ],
      })

      const changedSecrets = {
        "existing-key": "updated-value",
        "new-key": "new-value",
      }

      // act
      await secretService.updateInstanceSecrets(project.id, instance.id, changedSecrets)

      // assert
      const secrets = await projectDatabase.secret.findMany({
        where: { stateId: instance.id },
        orderBy: { name: "asc" },
      })
      expect(secrets).toHaveLength(3)

      expect(secrets[0].name).toBe("existing-key")
      expect(secrets[0].content).toBe("updated-value")
      expect(secrets[0].meta).toEqual({
        title: "Existing Configuration Key",
        description: "Legacy configuration key maintained for compatibility",
        icon: "mdi:cog",
      })

      expect(secrets[1].name).toBe("new-key")
      expect(secrets[1].content).toBe("new-value")
      expect(secrets[1].meta).toEqual({
        title: "New Access Token",
        description: "Newly generated access token for service authentication",
        icon: "mdi:shield-key",
      })

      expect(secrets[2].name).toBe("to-preserve")
      expect(secrets[2].content).toBe("preserve-me")
      expect(secrets[2].meta).toEqual({ title: "To Preserve" })
    },
  )

  secretTest("throws error when instance not found", async ({ secretService, project, expect }) => {
    // arrange
    const stateId = "server.v1:nonexistent"

    // act & assert
    await expect(secretService.updateInstanceSecrets(project.id, stateId, {})).rejects.toThrow(
      InstanceStateNotFoundError,
    )
  })

  secretTest(
    "throws error when instance is not a unit",
    async ({ secretService, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id, "component.v1", "composite")

      // act & assert
      await expect(
        secretService.updateInstanceSecrets(project.id, instance.id, {}),
      ).rejects.toThrow(InvalidInstanceKindError)
    },
  )

  secretTest(
    "correctly assigns meta from component secret definition",
    async ({ secretService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)

      const changedSecrets = {
        "api-key": "test-api-key-value",
      }

      // act
      await secretService.updateInstanceSecrets(project.id, instance.id, changedSecrets)

      // assert
      const secrets = await projectDatabase.secret.findMany({
        where: { stateId: instance.id },
      })
      expect(secrets).toHaveLength(1)

      const secret = secrets[0]
      expect(secret.name).toBe("api-key")
      expect(secret.content).toBe("test-api-key-value")

      // verify meta is correctly assigned from component definition
      expect(secret.meta).toEqual({
        title: "API Key",
        description: "Authentication key for external service access",
        icon: "mdi:key",
      })
    },
  )
})

describe("getInstanceSecretValues", () => {
  secretTest(
    "returns secret values for unit instance",
    async ({ secretService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)

      await projectDatabase.secret.createMany({
        data: [
          {
            id: createId(),
            stateId: instance.id,
            name: "api-key",
            meta: { title: "API Key" },
            content: "secret-api-key",
          },
          {
            id: createId(),
            stateId: instance.id,
            name: "password",
            meta: { title: "Password" },
            content: "secret-password",
          },
        ],
      })

      // act
      const values = await secretService.getInstanceSecretValues(project.id, instance.id)

      // assert
      expect(values).toEqual({
        "api-key": "secret-api-key",
        password: "secret-password",
      })
    },
  )

  secretTest(
    "returns empty object when no secrets exist",
    async ({ secretService, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)

      // act
      const values = await secretService.getInstanceSecretValues(project.id, instance.id)

      // assert
      expect(values).toEqual({})
    },
  )

  secretTest(
    "ignores secrets without names",
    async ({ secretService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)

      await projectDatabase.secret.createMany({
        data: [
          {
            id: createId(),
            stateId: instance.id,
            name: "api-key",
            meta: { title: "API Key" },
            content: "secret-api-key",
          },
          {
            id: createId(),
            stateId: instance.id,
            name: null,
            meta: { title: "Unnamed" },
            content: "unnamed-secret",
          },
        ],
      })

      // act
      const values = await secretService.getInstanceSecretValues(project.id, instance.id)

      // assert
      expect(values).toEqual({
        "api-key": "secret-api-key",
      })
    },
  )

  secretTest("throws error when instance not found", async ({ secretService, project, expect }) => {
    // arrange
    const stateId = "server.v1:nonexistent"

    // act & assert
    await expect(secretService.getInstanceSecretValues(project.id, stateId)).rejects.toThrow(
      InstanceStateNotFoundError,
    )
  })

  secretTest(
    "throws error when instance is not a unit",
    async ({ secretService, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id, "component.v1", "composite")

      // act & assert
      await expect(secretService.getInstanceSecretValues(project.id, instance.id)).rejects.toThrow(
        InvalidInstanceKindError,
      )
    },
  )
})

describe("getPulumiPassword", () => {
  secretTest(
    "returns existing Pulumi password",
    async ({ secretService, projectDatabase, project, expect }) => {
      // arrange
      const existingPassword = "existing-password"
      await projectDatabase.secret.create({
        data: {
          id: createId(),
          systemName: SystemSecretNames.PulumiPassword,
          meta: {
            title: "Pulumi Password",
            description: "The password used to encrypt the Pulumi state.",
            icon: "devicon:pulumi",
          },
          content: existingPassword,
        },
      })

      // act
      const password = await secretService.getPulumiPassword(project.id)

      // assert
      expect(password).toBe(existingPassword)
    },
  )

  secretTest(
    "creates new Pulumi password when none exists",
    async ({ secretService, projectDatabase, project, expect }) => {
      // act
      const password = await secretService.getPulumiPassword(project.id)

      // assert
      expect(password).toBeDefined()
      expect(typeof password).toBe("string")
      expect(password.length).toBeGreaterThan(0)

      // verify it was saved to database
      const savedSecret = await projectDatabase.secret.findUnique({
        where: { systemName: SystemSecretNames.PulumiPassword },
      })
      expect(savedSecret).toBeDefined()
      expect(savedSecret?.content).toBe(password)
      expect(savedSecret?.meta).toEqual({
        title: "Pulumi Password",
        description: "The password used to encrypt the Pulumi state.",
        icon: "devicon:pulumi",
      })
    },
  )

  secretTest(
    "returns same password on subsequent calls",
    async ({ secretService, project, expect }) => {
      // act
      const password1 = await secretService.getPulumiPassword(project.id)
      const password2 = await secretService.getPulumiPassword(project.id)

      // assert
      expect(password1).toBe(password2)
    },
  )
})

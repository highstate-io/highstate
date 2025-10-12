import { createId } from "@paralleldrive/cuid2"
import { generateIdentity, identityToRecipient } from "age-encryption"
import { describe } from "vitest"
import { test } from "../test-utils"
import { SettingsService } from "./settings"

const settingsTest = test.extend<{
  settingsService: SettingsService
}>({
  settingsService: [
    async ({ database }, use) => {
      const settingsService = new SettingsService(database)

      await use(settingsService)
    },
    { scope: "file" },
  ],
})

describe("SettingsService", () => {
  describe("queryOperations", () => {
    settingsTest(
      "returns operations without search",
      async ({ settingsService, projectDatabase, project, expect }) => {
        // clear operations table
        await projectDatabase.operation.deleteMany()

        // arrange
        const operation1 = await projectDatabase.operation.create({
          data: {
            id: createId(),
            type: "update",
            status: "completed",
            meta: { title: "Update Operation" },
            options: {},
            requestedInstanceIds: [],
            startedAt: new Date("2023-01-01"),
            updatedAt: new Date("2023-01-01"),
          },
        })

        const operation2 = await projectDatabase.operation.create({
          data: {
            id: createId(),
            type: "destroy",
            status: "pending",
            meta: { title: "Destroy Operation" },
            options: {},
            requestedInstanceIds: [],
            startedAt: new Date("2023-01-02"),
            updatedAt: new Date("2023-01-02"),
          },
        })

        // act
        const result = await settingsService.queryOperations(project.id, {
          sortBy: [{ key: "startedAt", order: "asc" }],
        })

        // assert
        expect(result.items).toHaveLength(2)
        expect(result.total).toBe(2)
        expect(result.items[0].id).toBe(operation1.id)
        expect(result.items[1].id).toBe(operation2.id)
      },
    )

    settingsTest(
      "searches operations by meta title",
      async ({ settingsService, projectDatabase, project, expect }) => {
        // clear operations table
        await projectDatabase.operation.deleteMany()

        // arrange
        await projectDatabase.operation.create({
          data: {
            id: createId(),
            type: "update",
            status: "completed",
            meta: { title: "Update Operation" },
            options: {},
            requestedInstanceIds: [],
            startedAt: new Date("2023-01-01"),
            updatedAt: new Date("2023-01-01"),
          },
        })

        await projectDatabase.operation.create({
          data: {
            id: createId(),
            type: "destroy",
            status: "pending",
            meta: { title: "Destroy Operation" },
            options: {},
            requestedInstanceIds: [],
            startedAt: new Date("2023-01-02"),
            updatedAt: new Date("2023-01-02"),
          },
        })

        // act
        const result = await settingsService.queryOperations(project.id, {
          sortBy: [{ key: "startedAt", order: "asc" }],
          search: "Update",
        })

        // assert
        expect(result.items).toHaveLength(1)
        expect(result.items[0].meta.title).toBe("Update Operation")
      },
    )

    settingsTest(
      "searches operations by type",
      async ({ settingsService, projectDatabase, project, expect }) => {
        // clear operations table
        await projectDatabase.operation.deleteMany()

        // arrange
        await projectDatabase.operation.create({
          data: {
            id: createId(),
            type: "update",
            status: "completed",
            meta: { title: "Update Operation" },
            options: {},
            requestedInstanceIds: [],
            startedAt: new Date("2023-01-01"),
            updatedAt: new Date("2023-01-01"),
          },
        })

        await projectDatabase.operation.create({
          data: {
            id: createId(),
            type: "destroy",
            status: "pending",
            meta: { title: "Destroy Operation" },
            options: {},
            requestedInstanceIds: [],
            startedAt: new Date("2023-01-02"),
            updatedAt: new Date("2023-01-02"),
          },
        })

        // act
        const result = await settingsService.queryOperations(project.id, {
          sortBy: [{ key: "startedAt", order: "asc" }],
          search: "destroy",
        })

        // assert
        expect(result.items).toHaveLength(1)
        expect(result.items[0].type).toBe("destroy")
      },
    )

    settingsTest(
      "supports page-based pagination",
      async ({ settingsService, projectDatabase, project, expect }) => {
        // clear operations table
        await projectDatabase.operation.deleteMany()

        // arrange
        const startDate1 = new Date("2023-01-01")
        const startDate2 = new Date("2023-01-02")
        const startDate3 = new Date("2023-01-03")

        await projectDatabase.operation.create({
          data: {
            id: createId(),
            type: "update",
            status: "completed",
            meta: { title: "Operation 1" },
            options: {},
            requestedInstanceIds: [],
            startedAt: startDate1,
            updatedAt: startDate1,
          },
        })

        await projectDatabase.operation.create({
          data: {
            id: createId(),
            type: "update",
            status: "completed",
            meta: { title: "Operation 2" },
            options: {},
            requestedInstanceIds: [],
            startedAt: startDate2,
            updatedAt: startDate2,
          },
        })

        await projectDatabase.operation.create({
          data: {
            id: createId(),
            type: "update",
            status: "completed",
            meta: { title: "Operation 3" },
            options: {},
            requestedInstanceIds: [],
            startedAt: startDate3,
            updatedAt: startDate3,
          },
        })

        // act - get first page
        const firstPage = await settingsService.queryOperations(project.id, {
          sortBy: [{ key: "startedAt", order: "asc" }],
          count: 2,
          skip: 0,
        })

        // assert first page
        expect(firstPage.items).toHaveLength(2)
        expect(firstPage.total).toBe(3)
        expect(firstPage.items[0].meta.title).toBe("Operation 1")
        expect(firstPage.items[1].meta.title).toBe("Operation 2")

        // act - get second page
        const secondPage = await settingsService.queryOperations(project.id, {
          sortBy: [{ key: "startedAt", order: "asc" }],
          count: 2,
          skip: 2,
        })

        // assert second page
        expect(secondPage.items).toHaveLength(1)
        expect(secondPage.total).toBe(3)
        expect(secondPage.items[0].meta.title).toBe("Operation 3")
      },
    )

    settingsTest(
      "respects sort order",
      async ({ settingsService, projectDatabase, project, expect }) => {
        // clear operations table
        await projectDatabase.operation.deleteMany()

        // arrange
        const startDate1 = new Date("2023-01-01")
        const startDate2 = new Date("2023-01-02")

        await projectDatabase.operation.create({
          data: {
            id: createId(),
            type: "update",
            status: "completed",
            meta: { title: "Earlier Operation" },
            options: {},
            requestedInstanceIds: [],
            startedAt: startDate1,
            updatedAt: startDate1,
          },
        })

        await projectDatabase.operation.create({
          data: {
            id: createId(),
            type: "update",
            status: "completed",
            meta: { title: "Later Operation" },
            options: {},
            requestedInstanceIds: [],
            startedAt: startDate2,
            updatedAt: startDate2,
          },
        })

        // act - descending order
        const descResult = await settingsService.queryOperations(project.id, {
          sortBy: [{ key: "startedAt", order: "desc" }],
        })

        // assert
        expect(descResult.items[0].meta.title).toBe("Later Operation")
        expect(descResult.items[1].meta.title).toBe("Earlier Operation")
      },
    )
  })

  describe("queryTerminals", () => {
    settingsTest(
      "returns terminals without search",
      async ({ settingsService, projectDatabase, project, expect }) => {
        // clear terminals table
        await projectDatabase.terminal.deleteMany()

        // arrange
        const terminal1 = await projectDatabase.terminal.create({
          data: {
            id: createId(),
            name: "terminal-1",
            meta: { title: "Terminal 1" },
            status: "active",
            spec: {},
            createdAt: new Date("2023-01-01"),
          },
        })

        const terminal2 = await projectDatabase.terminal.create({
          data: {
            id: createId(),
            name: "terminal-2",
            meta: { title: "Terminal 2" },
            status: "active",
            spec: {},
            createdAt: new Date("2023-01-02"),
          },
        })

        // act
        const result = await settingsService.queryTerminals(project.id, {
          sortBy: [{ key: "createdAt", order: "asc" }],
        })

        // assert
        expect(result.items).toHaveLength(2)
        expect(result.total).toBe(2)
        expect(result.items[0].id).toBe(terminal1.id)
        expect(result.items[1].id).toBe(terminal2.id)
      },
    )

    settingsTest(
      "searches terminals by name and meta title",
      async ({ settingsService, projectDatabase, project, expect }) => {
        // clear terminals table
        await projectDatabase.terminal.deleteMany()

        // arrange
        await projectDatabase.terminal.create({
          data: {
            id: createId(),
            name: "web-terminal",
            meta: { title: "Web Terminal" },
            status: "active",
            spec: {},
            createdAt: new Date("2023-01-01"),
          },
        })

        await projectDatabase.terminal.create({
          data: {
            id: createId(),
            name: "ssh-terminal",
            meta: { title: "SSH Terminal" },
            status: "active",
            spec: {},
            createdAt: new Date("2023-01-02"),
          },
        })

        // act - search by name
        const nameResult = await settingsService.queryTerminals(project.id, {
          sortBy: [{ key: "createdAt", order: "asc" }],
          search: "web",
        })

        // assert
        expect(nameResult.items).toHaveLength(1)
        expect(nameResult.items[0].name).toBe("web-terminal")

        // act - search by meta title
        const titleResult = await settingsService.queryTerminals(project.id, {
          sortBy: [{ key: "createdAt", order: "asc" }],
          search: "SSH",
        })

        // assert
        expect(titleResult.items).toHaveLength(1)
        expect(titleResult.items[0].meta.title).toBe("SSH Terminal")
      },
    )
  })

  describe("queryWorkers", () => {
    settingsTest(
      "returns workers and searches by id and identity",
      async ({ settingsService, projectDatabase, project, expect }) => {
        // clear workers and service accounts tables
        await projectDatabase.worker.deleteMany()
        await projectDatabase.serviceAccount.deleteMany()

        // arrange
        const serviceAccount1 = await projectDatabase.serviceAccount.create({
          data: {
            id: createId(),
            meta: { title: "Test Service Account 1" },
          },
        })

        const serviceAccount2 = await projectDatabase.serviceAccount.create({
          data: {
            id: createId(),
            meta: { title: "Test Service Account 2" },
          },
        })

        await projectDatabase.worker.create({
          data: {
            id: "worker-123",
            identity: "ghcr.io/org/worker1",
            serviceAccountId: serviceAccount1.id,
            createdAt: new Date("2023-01-01"),
          },
        })

        await projectDatabase.worker.create({
          data: {
            id: "worker-456",
            identity: "ghcr.io/org/worker2",
            serviceAccountId: serviceAccount2.id,
            createdAt: new Date("2023-01-02"),
          },
        })

        // act - no search
        const allResult = await settingsService.queryWorkers(project.id, {
          sortBy: [{ key: "createdAt", order: "asc" }],
        })

        // assert
        expect(allResult.items).toHaveLength(2)

        // act - search by id
        const idResult = await settingsService.queryWorkers(project.id, {
          sortBy: [{ key: "createdAt", order: "asc" }],
          search: "123",
        })

        // assert
        expect(idResult.items).toHaveLength(1)
        expect(idResult.items[0].id).toBe("worker-123")

        // act - search by identity
        const identityResult = await settingsService.queryWorkers(project.id, {
          sortBy: [{ key: "createdAt", order: "asc" }],
          search: "worker2",
        })

        // assert
        expect(identityResult.items).toHaveLength(1)
        expect(identityResult.items[0].identity).toBe("ghcr.io/org/worker2")
      },
    )
  })

  describe("queryUnlockMethods", () => {
    settingsTest(
      "returns unlock methods and searches by type",
      async ({ settingsService, projectDatabase, project, expect }) => {
        // clear unlock methods table
        await projectDatabase.unlockMethod.deleteMany()

        // arrange
        await projectDatabase.unlockMethod.create({
          data: {
            id: createId(),
            type: "password",
            meta: { title: "Password Method" },
            encryptedIdentity: "encrypted-pwd",
            recipient: await identityToRecipient(await generateIdentity()),
            createdAt: new Date("2023-01-01"),
            updatedAt: new Date("2023-01-01"),
          },
        })

        await projectDatabase.unlockMethod.create({
          data: {
            id: createId(),
            type: "passkey",
            meta: { title: "Passkey Method" },
            encryptedIdentity: "encrypted-key",
            recipient: await identityToRecipient(await generateIdentity()),
            createdAt: new Date("2023-01-02"),
            updatedAt: new Date("2023-01-02"),
          },
        })

        // act - no search
        const allResult = await settingsService.queryUnlockMethods(project.id, {
          sortBy: [{ key: "createdAt", order: "asc" }],
        })

        // assert
        expect(allResult.items).toHaveLength(2)

        // act - search by type
        const passwordResult = await settingsService.queryUnlockMethods(project.id, {
          sortBy: [{ key: "createdAt", order: "asc" }],
          search: "password",
        })

        // assert
        expect(passwordResult.items).toHaveLength(1)
        expect(passwordResult.items[0].type).toBe("password")

        // act - search by meta title
        const titleResult = await settingsService.queryUnlockMethods(project.id, {
          sortBy: [{ key: "createdAt", order: "asc" }],
          search: "Passkey",
        })

        // assert
        expect(titleResult.items).toHaveLength(1)
        expect(titleResult.items[0].meta.title).toBe("Passkey Method")
      },
    )
  })

  describe("queryArtifacts", () => {
    settingsTest(
      "returns artifacts and searches by hash",
      async ({ settingsService, projectDatabase, project, expect }) => {
        // clear artifacts table
        await projectDatabase.artifact.deleteMany()

        // arrange
        await projectDatabase.artifact.create({
          data: {
            id: createId(),
            meta: { title: "Test Artifact 1" },
            hash: "abc123",
            size: 1024,
            chunkSize: 512,
            createdAt: new Date("2023-01-01"),
            updatedAt: new Date("2023-01-01"),
          },
        })

        await projectDatabase.artifact.create({
          data: {
            id: createId(),
            meta: { title: "Test Artifact 2" },
            hash: "def456",
            size: 2048,
            chunkSize: 1024,
            createdAt: new Date("2023-01-02"),
            updatedAt: new Date("2023-01-02"),
          },
        })

        // act - search by hash
        const result = await settingsService.queryArtifacts(project.id, {
          sortBy: [{ key: "createdAt", order: "asc" }],
          search: "abc",
        })

        // assert
        expect(result.items).toHaveLength(1)
        expect(result.items[0].hash).toBe("abc123")
      },
    )
  })

  describe("queryPages", () => {
    settingsTest(
      "returns pages and searches by name",
      async ({ settingsService, projectDatabase, project, expect }) => {
        // clear pages table
        await projectDatabase.page.deleteMany()

        // arrange
        await projectDatabase.page.create({
          data: {
            id: createId(),
            name: "home-page",
            meta: { title: "Home Page" },
            content: {},
            createdAt: new Date("2023-01-01"),
            updatedAt: new Date("2023-01-01"),
          },
        })

        await projectDatabase.page.create({
          data: {
            id: createId(),
            name: "about-page",
            meta: { title: "About Page" },
            content: {},
            createdAt: new Date("2023-01-02"),
            updatedAt: new Date("2023-01-02"),
          },
        })

        // act
        const result = await settingsService.queryPages(project.id, {
          sortBy: [{ key: "createdAt", order: "asc" }],
          search: "home",
        })

        // assert
        expect(result.items).toHaveLength(1)
        expect(result.items[0].name).toBe("home-page")
      },
    )
  })

  describe("querySecrets", () => {
    settingsTest(
      "returns secrets and searches by name",
      async ({ settingsService, projectDatabase, project, createInstanceState, expect }) => {
        // clear secrets and instance state tables
        await projectDatabase.secret.deleteMany()
        await projectDatabase.instanceState.deleteMany()

        // arrange
        const instance = await createInstanceState(project.id)

        await projectDatabase.secret.create({
          data: {
            id: createId(),
            name: "api-key",
            meta: { title: "API Key" },
            content: "secret-value",
            stateId: instance.id,
            createdAt: new Date("2023-01-01"),
            updatedAt: new Date("2023-01-01"),
          },
        })

        await projectDatabase.secret.create({
          data: {
            id: createId(),
            name: "db-password",
            meta: { title: "Database Password" },
            content: "secret-password",
            stateId: instance.id,
            createdAt: new Date("2023-01-02"),
            updatedAt: new Date("2023-01-02"),
          },
        })

        // act
        const result = await settingsService.querySecrets(project.id, {
          sortBy: [{ key: "createdAt", order: "asc" }],
          search: "api",
        })

        // assert
        expect(result.items).toHaveLength(1)
        expect(result.items[0].name).toBe("api-key")
      },
    )
  })

  describe("queryTriggers", () => {
    settingsTest(
      "returns triggers and searches by name",
      async ({ settingsService, projectDatabase, project, createInstanceState, expect }) => {
        // clear triggers and instance state tables
        await projectDatabase.trigger.deleteMany()
        await projectDatabase.instanceState.deleteMany()

        // arrange
        const instance = await createInstanceState(project.id)

        await projectDatabase.trigger.create({
          data: {
            id: createId(),
            name: "deploy-trigger",
            meta: { title: "Deploy Trigger" },
            spec: {},
            stateId: instance.id,
            createdAt: new Date("2023-01-01"),
            updatedAt: new Date("2023-01-01"),
          },
        })

        await projectDatabase.trigger.create({
          data: {
            id: createId(),
            name: "backup-trigger",
            meta: { title: "Backup Trigger" },
            spec: {},
            stateId: instance.id,
            createdAt: new Date("2023-01-02"),
            updatedAt: new Date("2023-01-02"),
          },
        })

        // act
        const result = await settingsService.queryTriggers(project.id, {
          sortBy: [{ key: "createdAt", order: "asc" }],
          search: "deploy",
        })

        // assert
        expect(result.items).toHaveLength(1)
        expect(result.items[0].name).toBe("deploy-trigger")
      },
    )
  })
})

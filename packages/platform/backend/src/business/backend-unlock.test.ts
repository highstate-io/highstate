import { hostname } from "node:os"
import { describe, expect } from "vitest"
import { getInitialBackendUnlockMethodMeta } from "../database/local/backend"
import { test } from "../test-utils"
import { TestDatabaseManager } from "../test-utils/database"
import { BackendUnlockService } from "./backend-unlock"

const backendUnlockTest = test.extend<{
  encryptedDatabase: TestDatabaseManager
  backendUnlockService: BackendUnlockService
}>({
  encryptedDatabase: [
    async ({ logger }, use) => {
      const database = await TestDatabaseManager.create(logger, {
        isEncryptionEnabled: true,
      })

      try {
        await use(database)
      } finally {
        await database.cleanup()
      }
    },
    { scope: "file" },
  ],
  backendUnlockService: [
    async ({ encryptedDatabase, logger }, use) => {
      const service = new BackendUnlockService(
        encryptedDatabase,
        logger.child({ service: "BackendUnlockServiceTest" }),
      )

      await use(service)
    },
    { scope: "file" },
  ],
})

describe("BackendUnlockService", () => {
  backendUnlockTest(
    "seeds an initial unlock method for the local machine",
    async ({ encryptedDatabase }) => {
      const methods = await encryptedDatabase.backend.backendUnlockMethod.findMany()
      expect(methods.length).toBeGreaterThan(0)

      const [initial] = methods
      const meta = initial.meta as { title?: string; description?: string }

      const expectedMeta = getInitialBackendUnlockMethodMeta(hostname())

      expect(meta.title).toBe(expectedMeta.title)
      expect(meta.description).toBe(expectedMeta.description)
    },
  )

  backendUnlockTest("lists unlock methods", async ({ encryptedDatabase, backendUnlockService }) => {
    await encryptedDatabase.backend.backendUnlockMethod.deleteMany()

    const first = await encryptedDatabase.backend.backendUnlockMethod.create({
      data: {
        meta: { title: "Laptop" },
        recipient: "age1example1",
      },
    })

    const second = await encryptedDatabase.backend.backendUnlockMethod.create({
      data: {
        meta: { title: "Desktop", description: "Office" },
        recipient: "age1example2",
      },
    })

    const methods = await backendUnlockService.listUnlockMethods()

    expect(methods).toHaveLength(2)
    expect(methods[0].id).toBe(first.id)
    expect(methods[0].meta.title).toBe("Laptop")
    expect(methods[1].recipient).toBe(second.recipient)
    expect(methods[1].meta.description).toBe("Office")
  })

  backendUnlockTest(
    "adds unlock method and reencrypts master key",
    async ({ encryptedDatabase, backendUnlockService }) => {
      await encryptedDatabase.backend.backendUnlockMethod.deleteMany()
      encryptedDatabase.backendUnlockRecipientUpdates.length = 0

      const result = await backendUnlockService.addUnlockMethod({
        meta: { title: "Laptop" },
        recipient: "age1newrecipient",
      })

      expect(result.meta.title).toBe("Laptop")
      const stored = await encryptedDatabase.backend.backendUnlockMethod.findUniqueOrThrow({
        where: { id: result.id },
      })
      expect(stored.recipient).toBe("age1newrecipient")
      expect(encryptedDatabase.backendUnlockRecipientUpdates).toHaveLength(1)
      expect(encryptedDatabase.backendUnlockRecipientUpdates[0]).toEqual(["age1newrecipient"])
    },
  )

  backendUnlockTest(
    "deletes unlock method and reencrypts master key",
    async ({ encryptedDatabase, backendUnlockService }) => {
      await encryptedDatabase.backend.backendUnlockMethod.deleteMany()

      const keep = await encryptedDatabase.backend.backendUnlockMethod.create({
        data: {
          meta: { title: "Primary" },
          recipient: "age1primary",
        },
      })

      const remove = await encryptedDatabase.backend.backendUnlockMethod.create({
        data: {
          meta: { title: "Old" },
          recipient: "age1old",
        },
      })

      encryptedDatabase.backendUnlockRecipientUpdates.length = 0

      await backendUnlockService.deleteUnlockMethod(remove.id)

      const remaining = await encryptedDatabase.backend.backendUnlockMethod.findMany()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe(keep.id)
      expect(encryptedDatabase.backendUnlockRecipientUpdates).toHaveLength(1)
      expect(encryptedDatabase.backendUnlockRecipientUpdates[0]).toEqual(["age1primary"])
    },
  )
})

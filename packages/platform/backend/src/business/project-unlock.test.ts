import type { DatabaseManager } from "../database"
import type { PubSubManager } from "../pubsub"
import type { ProjectUnlockBackend } from "../unlock"
import type { ObjectRefIndexService } from "./object-ref-index"
import { armor, Decrypter, Encrypter, generateIdentity, identityToRecipient } from "age-encryption"
import { pino } from "pino"
import { describe, expect, test, vi } from "vitest"
import { projectUnlockSuiteSchema } from "../shared"
import { adminBackendContext } from "../test-utils"
import { ProjectKeyring } from "./project-keyring"
import { ProjectUnlockService } from "./project-unlock"

describe("ProjectUnlockService", () => {
  test.each([
    "initial",
    "additional",
  ])("supports a keyring as an %s method with real AGE encryption", async mode => {
    const identity = await generateIdentity()
    const recipient = await identityToRecipient(identity)
    const keyring = new ProjectKeyring()
    vi.spyOn(keyring, "getOrCreateRecipient").mockResolvedValue(recipient)
    vi.spyOn(keyring, "getIdentity").mockResolvedValue(identity)

    const methods: {
      id?: string
      type: "keyring" | "password"
      recipient: string
      encryptedIdentity: string
    }[] = []

    const passwordIdentity = await generateIdentity()

    if (mode === "additional") {
      methods.push({
        id: "password",
        type: "password",
        recipient: await identityToRecipient(passwordIdentity),
        encryptedIdentity: "password envelope",
      })
    }

    const create = vi.fn(async ({ data }) => {
      methods.push({ ...data, id: "method" })
      return { id: "method" }
    })

    const projectDatabase = {
      unlockMethod: {
        create,
        findMany: vi.fn(async args => methods.filter(method => method.id !== args?.where?.id?.not)),
        delete: vi.fn(async ({ where }) =>
          methods.splice(
            methods.findIndex(method => method.id === where.id),
            1,
          ),
        ),
      },
      $transaction: async (callback: (tx: unknown) => Promise<void>) =>
        await callback(projectDatabase),
    }

    let record: Record<string, unknown> = { spaceId: "space" }

    const update = vi.fn(async ({ data }) => {
      record = { ...record, ...data }
    })

    const database = {
      setupDatabase: vi.fn(async () => projectDatabase),
      forProject: vi.fn(async () => projectDatabase),
      getProjectMasterKey: vi.fn(async () => Buffer.from("master-key")),
      backend: {
        project: {
          findUnique: vi.fn(async () => record),
          findUniqueOrThrow: vi.fn(async () => record),
          update,
        },
        projectSpace: { findMany: vi.fn(async () => [{ id: "space", parentId: null }]) },
      },
    } as unknown as DatabaseManager

    const projectPrivateKey = await generateIdentity()

    const unlockBackend = {
      unlockProject: vi.fn(async () => {}),
      checkProjectUnlocked: vi.fn(async () => false),
      getProjectPrivateKey: vi.fn(async () => projectPrivateKey),
    }

    const service = new ProjectUnlockService(
      database,
      { publish: vi.fn() } as unknown as PubSubManager,
      unlockBackend as unknown as ProjectUnlockBackend,
      { track: vi.fn() } as unknown as ObjectRefIndexService,
      { HIGHSTATE_ENCRYPTION_ENABLED: true, HIGHSTATE_DEV_AUTO_UNLOCK_PROJECT_IDS: [] },
      pino({ level: "silent" }),
      keyring,
    )

    const input = { type: "keyring" as const, meta: { title: "Host keyring" } }

    if (mode === "initial") {
      const [encryptedMasterKey, encryptedPrivateKey, publicKey, unlockSuite] =
        await service.setupProjectDatabase("project", input)

      record = { ...record, encryptedMasterKey, encryptedPrivateKey, publicKey, unlockSuite }
    } else {
      await service.addProjectUnlockMethod("project", input)
    }

    const suite = projectUnlockSuiteSchema.parse(record.unlockSuite)
    expect(suite.encryptedIdentities).toEqual(mode === "initial" ? [] : ["password envelope"])
    expect(suite.keyringRecipients).toEqual([recipient])

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          ...input,
          recipient,
          encryptedIdentity: "",
        },
      }),
    )

    const beforeRetry = record.encryptedMasterKey
    await service.addProjectUnlockMethod("project", input)
    expect(create).toHaveBeenCalledTimes(1)
    expect(record.encryptedMasterKey).toBe(beforeRetry)

    const decrypter = new Decrypter()
    decrypter.addIdentity(identity)

    expect(await decrypter.decrypt(armor.decode(record.encryptedMasterKey as string), "text")).toBe(
      "master-key",
    )

    await service.unlockProjectWithKeyring(adminBackendContext(), "project", recipient)

    expect(unlockBackend.unlockProject).toHaveBeenLastCalledWith(
      "project",
      Buffer.from("master-key"),
      expect.stringContaining("AGE-SECRET-KEY"),
    )

    vi.mocked(keyring.getIdentity).mockClear()

    await expect(
      service.unlockProjectWithKeyring(adminBackendContext(), "project", "unattached"),
    ).rejects.toThrow("not attached")

    expect(keyring.getIdentity).not.toHaveBeenCalled()

    if (mode === "additional") {
      const passwordDecrypter = new Decrypter()
      passwordDecrypter.addIdentity(passwordIdentity)

      expect(
        await passwordDecrypter.decrypt(armor.decode(record.encryptedMasterKey as string), "text"),
      ).toBe("master-key")

      await service.removeProjectUnlockMethod("project", "method")
      expect(projectUnlockSuiteSchema.parse(record.unlockSuite).keyringRecipients).toEqual([])

      expect(
        await passwordDecrypter.decrypt(armor.decode(record.encryptedMasterKey as string), "text"),
      ).toBe("master-key")

      await expect(
        decrypter.decrypt(armor.decode(record.encryptedMasterKey as string), "text"),
      ).rejects.toThrow()
    } else {
      await expect(service.removeProjectUnlockMethod("project", "method")).rejects.toThrow()
    }
  })

  test("parses existing unlock suites without passkey references", () => {
    const unlockSuite = projectUnlockSuiteSchema.parse({
      encryptedIdentities: ["encrypted-identity"],
      hasPasskey: true,
    })

    expect(unlockSuite).toEqual({
      encryptedIdentities: ["encrypted-identity"],
      hasPasskey: true,
      passkeys: [],
      keyringRecipients: [],
    })
  })

  test("unlocks project when encrypted private key is missing", async () => {
    const decryptedIdentity = await generateIdentity()
    const recipient = await identityToRecipient(decryptedIdentity)

    const encrypter = new Encrypter()
    encrypter.addRecipient(recipient)

    const encryptedMasterKey = armor.encode(await encrypter.encrypt("master-key"))
    const callOrder: string[] = []

    const updateProject = vi.fn().mockImplementation(async () => {
      callOrder.push("backfill")
    })

    const findUnlockMethods = vi.fn().mockResolvedValue([
      {
        type: "identity",
        recipient,
        encryptedIdentity: "encrypted-identity-1",
      },
    ])

    const database = {
      getProjectMasterKey: vi.fn().mockResolvedValue(Buffer.from("master-key")),
      forProject: vi.fn().mockResolvedValue({
        unlockMethod: {
          findMany: findUnlockMethods,
        },
      }),
      backend: {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            spaceId: "space-1",
            encryptedMasterKey,
            encryptedPrivateKey: null,
          }),
          update: updateProject,
        },
        projectSpace: {
          findMany: vi.fn().mockResolvedValue([{ id: "space-1", parentId: null }]),
        },
      },
    } as unknown as DatabaseManager

    const pubsubManager = {
      publish: vi.fn().mockResolvedValue(undefined),
    } as unknown as PubSubManager

    const projectUnlockBackend = {
      checkProjectUnlocked: vi.fn().mockResolvedValue(false),
      unlockProject: vi.fn().mockImplementation(async () => {
        callOrder.push("unlock")
      }),
    } as unknown as ProjectUnlockBackend

    const objectRefIndexService = {} as unknown as ObjectRefIndexService

    const service = new ProjectUnlockService(
      database,
      pubsubManager,
      projectUnlockBackend,
      objectRefIndexService,
      {
        HIGHSTATE_ENCRYPTION_ENABLED: true,
        HIGHSTATE_DEV_AUTO_UNLOCK_PROJECT_IDS: [],
      },
      pino({ level: "silent" }),
    )

    await service.unlockProject(adminBackendContext(), "project-1", decryptedIdentity)

    expect(projectUnlockBackend.unlockProject).toHaveBeenCalledTimes(2)

    const unlockCalls = vi.mocked(projectUnlockBackend.unlockProject).mock.calls as [
      string,
      Buffer,
      string,
    ][]

    const [firstCall, secondCall] = unlockCalls

    expect(firstCall).toBeDefined()
    expect(secondCall).toBeDefined()

    const [firstProjectId, firstMasterKey, firstPrivateKey] = firstCall!
    const [secondProjectId, secondMasterKey, secondPrivateKey] = secondCall!

    // first unlock is temporary (no private key) to read unlock methods and backfill the key
    expect(firstProjectId).toBe("project-1")
    expect(Buffer.isBuffer(firstMasterKey)).toBe(true)
    expect(firstMasterKey.toString()).toBe("master-key")
    expect(firstPrivateKey).toBe("")

    // second unlock is final and uses the generated private key
    expect(secondProjectId).toBe("project-1")
    expect(Buffer.isBuffer(secondMasterKey)).toBe(true)
    expect(secondMasterKey.toString()).toBe("master-key")
    expect(secondPrivateKey).toContain("AGE-SECRET-KEY")

    expect(findUnlockMethods).toHaveBeenCalledTimes(1)
    expect(updateProject).toHaveBeenCalledTimes(1)

    const updatePayload =
      ((updateProject as unknown as { mock?: { calls?: unknown[][] } }).mock?.calls?.[0]?.[0] as
        | {
            data?: {
              encryptedPrivateKey?: string
              publicKey?: string
            }
          }
        | undefined) ?? {}

    expect(typeof updatePayload.data?.encryptedPrivateKey).toBe("string")
    expect((updatePayload.data?.encryptedPrivateKey?.length ?? 0) > 0).toBe(true)
    expect(updatePayload.data?.publicKey?.startsWith("age1")).toBe(true)
    expect(callOrder).toEqual(["unlock", "backfill", "unlock"])
  })
})

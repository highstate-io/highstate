import type { DatabaseManager } from "../database"
import type { PubSubManager } from "../pubsub"
import type { ProjectUnlockBackend } from "../unlock"
import type { ObjectRefIndexService } from "./object-ref-index"
import { armor, Encrypter, generateIdentity, identityToRecipient } from "age-encryption"
import { pino } from "pino"
import { describe, expect, test, vi } from "vitest"
import { ProjectUnlockService } from "./project-unlock"

describe("ProjectUnlockService", () => {
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
            encryptedMasterKey,
            encryptedPrivateKey: null,
          }),
          update: updateProject,
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

    await service.unlockProject("project-1", decryptedIdentity)

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

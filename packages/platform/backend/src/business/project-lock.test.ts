import type { DatabaseManager } from "../database"
import type { PubSubManager } from "../pubsub"
import type { ProjectUnlockBackend } from "../unlock"
import { pino } from "pino"
import { describe, expect, test, vi } from "vitest"
import { PermissionDeniedError } from "../shared"
import { adminBackendContext, createBackendRequestContext } from "../test-utils"
import { ProjectUnlockService } from "./project-unlock"

function setup() {
  let unlocked = true
  const calls: string[] = []
  const suite = { encryptedIdentities: ["password", "passkey"], hasPasskey: true }
  const count = vi.fn(async () => 0)

  const closeProject = vi.fn(async () => {
    calls.push("close")
  })

  const lockProject = vi.fn(async () => {
    unlocked = false
    calls.push("lock")
  })

  const publish = vi.fn(async () => {
    calls.push("publish")
  })

  const service = new ProjectUnlockService(
    {
      backend: {
        project: { findUnique: vi.fn(async () => ({ id: "project", unlockSuite: suite })) },
        projectSpace: { findMany: vi.fn(async () => []) },
      },
      forProject: vi.fn(async () => ({
        operation: { count },
        workerVersion: { count },
        terminalSession: { count },
      })),
      closeProject,
    } as unknown as DatabaseManager,
    { publish } as unknown as PubSubManager,
    { checkProjectUnlocked: async () => unlocked, lockProject } as unknown as ProjectUnlockBackend,
    {} as never,
    { HIGHSTATE_ENCRYPTION_ENABLED: true, HIGHSTATE_DEV_AUTO_UNLOCK_PROJECT_IDS: [] },
    pino({ level: "silent" }),
  )

  service.registerLockTask("cleanup", async () => {
    calls.push("cleanup")
  })

  return { service, calls, count, closeProject, lockProject, publish, suite }
}

describe("project locking", () => {
  test("cleans up, revokes access, closes the database, and broadcasts the portable unlock suite", async () => {
    const fixture = setup()
    await fixture.service.lockProject(adminBackendContext(), "project")
    expect(fixture.calls).toEqual(["cleanup", "lock", "close", "publish"])

    expect(fixture.publish).toHaveBeenCalledWith(["project-unlock-state", "project"], {
      type: "locked",
      unlockSuite: fixture.suite,
    })

    await fixture.service.lockProject(adminBackendContext(), "project")
    expect(fixture.lockProject).toHaveBeenCalledOnce()
  })

  test("requires project.lock before changing runtime state", async () => {
    const fixture = setup()

    await expect(
      fixture.service.lockProject(createBackendRequestContext(), "project"),
    ).rejects.toThrow(PermissionDeniedError)

    expect(fixture.calls).toEqual([])
  })

  test.each([
    0, 1, 2,
  ])("rejects an active workload in category %s without partially locking", async index => {
    const fixture = setup()
    fixture.count.mockImplementation(async () => 0)

    for (let i = 0; i <= index; i++) {
      fixture.count.mockResolvedValueOnce(i === index ? 1 : 0)
    }

    await expect(fixture.service.lockProject(adminBackendContext(), "project")).rejects.toThrow(
      "Stop active",
    )

    expect(fixture.calls).toEqual([])
  })

  test("keeps the project unlocked when cleanup fails", async () => {
    const fixture = setup()

    fixture.service.registerLockTask("cleanup", async () => {
      throw new Error("Cleanup failed")
    })

    await expect(fixture.service.lockProject(adminBackendContext(), "project")).rejects.toThrow(
      "Cleanup failed",
    )

    expect(fixture.lockProject).not.toHaveBeenCalled()
    expect(fixture.closeProject).not.toHaveBeenCalled()
  })
})

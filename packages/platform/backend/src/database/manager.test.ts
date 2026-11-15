import type { ProjectUnlockBackend } from "../unlock"
import type { BackendDatabaseBackend, ProjectDatabaseBackend } from "./abstractions"
import { pino } from "pino"
import { describe, expect, test, vi } from "vitest"
import { DatabaseManagerImpl } from "./manager"

describe("DatabaseManager project locking", () => {
  test("rejects cached database and master-key access after locking and disconnects the client", async () => {
    let unlocked = true
    const key = Buffer.alloc(32, 1)
    const client = { $disconnect: vi.fn(async () => {}) }

    const manager = new DatabaseManagerImpl(
      {} as BackendDatabaseBackend,
      {
        checkProjectUnlocked: async () => unlocked,
        getProjectMasterKey: async () => key,
      } as unknown as ProjectUnlockBackend,
      {} as ProjectDatabaseBackend,
      { HIGHSTATE_ENCRYPTION_ENABLED: true },
      pino({ level: "silent" }),
    )

    // Seed an already-open database without migration; exercise the real cache boundary.
    Reflect.get(manager, "projectDatabases").set("project", client)
    expect(await manager.forProject("project")).toBe(client)
    expect(await manager.getProjectMasterKey("project")).toBe(key)
    unlocked = false
    await expect(manager.forProject("project")).rejects.toThrow()
    await expect(manager.getProjectMasterKey("project")).rejects.toThrow()
    await manager.closeProject("project")
    expect(client.$disconnect).toHaveBeenCalledOnce()
    expect(Reflect.get(manager, "projectDatabases").has("project")).toBe(false)
    expect(Reflect.get(manager, "projectMasterKeys").has("project")).toBe(false)
  })
})

import type { ProjectUnlockBackend } from "./abstractions"

export class MemoryProjectUnlockBackend implements ProjectUnlockBackend {
  private readonly masterKeys = new Map<string, Buffer>()

  checkProjectUnlocked(projectId: string): Promise<boolean> {
    return Promise.resolve(this.masterKeys.has(projectId))
  }

  getProjectMasterKey(projectId: string): Promise<Buffer | null> {
    const masterKey = this.masterKeys.get(projectId)

    return Promise.resolve(masterKey ?? null)
  }

  lockProject(projectId: string): Promise<void> {
    this.masterKeys.delete(projectId)

    return Promise.resolve()
  }

  unlockProject(projectId: string, masterKey: Buffer): Promise<void> {
    this.masterKeys.set(projectId, masterKey)

    return Promise.resolve()
  }
}

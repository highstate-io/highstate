import type { ProjectUnlockBackend } from "./abstractions"

export class MemoryProjectUnlockBackend implements ProjectUnlockBackend {
  private readonly unlockData = new Map<string, { masterKey: Buffer; privateKey: string }>()

  checkProjectUnlocked(projectId: string): Promise<boolean> {
    return Promise.resolve(this.unlockData.has(projectId))
  }

  getProjectMasterKey(projectId: string): Promise<Buffer | null> {
    const masterKey = this.unlockData.get(projectId)?.masterKey

    return Promise.resolve(masterKey ?? null)
  }

  getProjectPrivateKey(projectId: string): Promise<string | null> {
    const privateKey = this.unlockData.get(projectId)?.privateKey

    return Promise.resolve(privateKey ?? null)
  }

  lockProject(projectId: string): Promise<void> {
    this.unlockData.delete(projectId)

    return Promise.resolve()
  }

  unlockProject(projectId: string, masterKey: Buffer, privateKey: string): Promise<void> {
    this.unlockData.set(projectId, { masterKey, privateKey })

    return Promise.resolve()
  }
}

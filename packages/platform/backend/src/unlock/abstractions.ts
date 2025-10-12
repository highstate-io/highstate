export interface ProjectUnlockBackend {
  /**
   * Checks if the project is unlocked.
   *
   * @param projectId The ID of the project to check.
   * @return A promise that resolves to true if the project is unlocked, false otherwise.
   */
  checkProjectUnlocked(projectId: string): Promise<boolean>

  /**
   * Gets the master key of the project or null if the project is not unlocked.
   *
   * @param projectId The ID of the project to get the information for.
   */
  getProjectMasterKey(projectId: string): Promise<Buffer | null>

  /**
   * Unlocks the project by setting its master key.
   *
   * @param projectId The ID of the project to unlock.
   * @param masterKey The base64-encoded master key for the project.
   */
  unlockProject(projectId: string, masterKey: Buffer): Promise<void>

  /**
   * Locks the project by wiping its master key.
   *
   * @param projectId The ID of the project to lock.
   */
  lockProject(projectId: string): Promise<void>
}

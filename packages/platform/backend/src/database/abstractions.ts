import type { BackendDatabase, ProjectDatabase } from "./prisma"

/**
 * Provides access to the backend database client and encryption helpers.
 */
export interface BackendDatabaseBackend {
  /**
   * The stable ID derived from the backend federation key.
   */
  readonly backendId: string

  /**
   * The AGE identity used for backend federation cryptography.
   */
  readonly privateKey: string

  /**
   * The database client for the backend database.
   */
  readonly database: BackendDatabase

  /**
   * Whether the backend database is encrypted.
   */
  readonly isEncryptionEnabled: boolean

  /**
   * Re-encrypts the backend secrets for the supplied recipients.
   *
   * @param recipients AGE recipients that must be able to decrypt the backend secrets.
   */
  reencryptSecrets(recipients: string[]): Promise<void>
}

export interface ProjectDatabaseBackend {
  /**
   * Opens the database for the project with the given ID.
   *
   * If the project does not exist, this will throw an error.
   *
   * @param projectId The ID of the project to open the database for.
   * @param masterKey The master key to decrypt the project database. If not provided, the encryption is assumed to be disabled.
   */
  openProjectDatabase(projectId: string, masterKey?: string): Promise<ProjectDatabase>
}

import type { Logger } from "pino"
import type { ProjectUnlockBackend } from "../unlock"
import type { BackendDatabase, ProjectDatabase } from "./prisma"
import { LRUCache } from "lru-cache"
import z from "zod"
import { createProjectLogger } from "../common"
import { BackendError, ProjectLockedError, ProjectNotFoundError } from "../shared"
import {
  type BackendDatabaseBackend,
  type ProjectDatabaseBackend,
  projectDatabaseVersion,
} from "./abstractions"
import { migrateDatabase } from "./migrate"

export const databaseManagerConfig = z.object({
  HIGHSTATE_ENCRYPTION_ENABLED: z.stringbool().default(true),
})

export interface DatabaseManager {
  /**
   * The backend database instance.
   */
  readonly backend: BackendDatabase

  /**
   * Whether the encryption is enabled for the backend and project databases.
   */
  readonly isEncryptionEnabled: boolean

  /**
   * Re-encrypts the backend master key so it can be decrypted by the provided recipients.
   *
   * @param recipients AGE recipients that must be able to decrypt the backend master key.
   */
  updateBackendUnlockRecipients(recipients: string[]): Promise<void>

  /**
   * Returns the master key of the project with the given ID.
   *
   * If the project does not exist or is not unlocked, this will throw an error.
   *
   * Returns `undefined` if the encryption is not enabled.
   *
   * @param projectId The ID of the project to get the master key for.
   * @returns A Promise that resolves to the master key of the project as a Uint8Array.
   */
  getProjectMasterKey(projectId: string): Promise<Buffer | undefined>

  /**
   * Sets up the database for the project with the given ID.
   *
   * Assumes that no database exists yet.
   *
   * The project must be unlocked before calling this method.
   *
   * @param projectId The ID of the project to set up the database for.
   */
  setupDatabase(projectId: string): Promise<ProjectDatabase>

  /**
   * Returns the database client for the project with the given ID.
   *
   * Automatically migrates the project database if necessary.
   *
   * If the project does not exist or not unlocked, this will throw an error.
   *
   * @param projectId The ID of the project to get the database client for.
   */
  forProject(projectId: string): Promise<ProjectDatabase>
}

export class DatabaseManagerImpl implements DatabaseManager {
  constructor(
    private readonly backendBackend: BackendDatabaseBackend,
    private readonly projectUnlockBackend: ProjectUnlockBackend,
    private readonly projectDatabaseBackend: ProjectDatabaseBackend,
    private readonly config: z.infer<typeof databaseManagerConfig>,
    private readonly logger: Logger,
  ) {}

  get backend(): BackendDatabase {
    return this.backendBackend.database
  }

  // store the master keys in memory cache for 30 seconds
  private readonly projectMasterKeys = new LRUCache<string, Buffer>({
    ttl: 30_000,
    ttlAutopurge: true,
  })

  // TODO: auto unload project databases after some time
  private readonly projectDatabases = new Map<string, ProjectDatabase>()

  get isEncryptionEnabled(): boolean {
    return this.config.HIGHSTATE_ENCRYPTION_ENABLED
  }

  /**
   * Delegates backend master-key rotation to the active backend database backend.
   *
   * @param recipients AGE recipients that must retain access to the backend master key.
   */
  async updateBackendUnlockRecipients(recipients: string[]): Promise<void> {
    if (!this.backendBackend.isEncryptionEnabled) {
      return
    }

    await this.backendBackend.reencryptMasterKey(recipients)
  }

  async getProjectMasterKey(projectId: string): Promise<Buffer | undefined> {
    if (!this.isEncryptionEnabled) {
      return undefined
    }

    const cachedInfo = this.projectMasterKeys.get(projectId)
    if (cachedInfo) {
      return cachedInfo
    }

    const masterKey = await this.projectUnlockBackend.getProjectMasterKey(projectId)
    if (!masterKey) {
      throw new ProjectLockedError(projectId)
    }

    this.projectMasterKeys.set(projectId, masterKey)
    return masterKey
  }

  async setupDatabase(projectId: string): Promise<ProjectDatabase> {
    const logger = createProjectLogger(this.logger, projectId)
    const masterKey = await this.getProjectMasterKey(projectId)
    const hexMasterKey = masterKey?.toString("hex")

    const [database, databaseUrl] = await this.projectDatabaseBackend.openProjectDatabase(
      projectId,
      hexMasterKey,
    )

    // can safely apply migrations here, because no one knows about the database yet
    await migrateDatabase(databaseUrl, "project", hexMasterKey, logger)

    this.projectDatabases.set(projectId, database)

    return database
  }

  async forProject(projectId: string): Promise<ProjectDatabase> {
    const cachedDatabase = this.projectDatabases.get(projectId)
    if (cachedDatabase) {
      return cachedDatabase
    }

    const masterKey = await this.getProjectMasterKey(projectId)
    const hexMasterKey = masterKey?.toString("hex")

    // TODO: is it really necessary to migrate the database inside the transaction?
    let database = await this.backend.$transaction(async tx => {
      const databaseEntity = await tx.project.findUnique({
        where: { id: projectId },
        select: { databaseVersion: true },
      })

      if (!databaseEntity) {
        throw new ProjectNotFoundError(projectId)
      }

      if (databaseEntity.databaseVersion > projectDatabaseVersion) {
        throw new BackendError(
          `Project database version (${databaseEntity.databaseVersion}) is newer than expected (${projectDatabaseVersion}).`,
        )
      }

      if (databaseEntity.databaseVersion === projectDatabaseVersion) {
        return
      }

      const [database, databaseUrl] = await this.projectDatabaseBackend.openProjectDatabase(
        projectId,
        hexMasterKey,
      )

      if (databaseEntity.databaseVersion < projectDatabaseVersion) {
        await migrateDatabase(databaseUrl, "project", hexMasterKey, this.logger)
      }

      await tx.project.update({
        where: { id: projectId },
        data: { databaseVersion: projectDatabaseVersion },
      })

      return database
    })

    if (!database) {
      // open database if was not migrated in the transaction
      const [_database] = await this.projectDatabaseBackend.openProjectDatabase(
        projectId,
        hexMasterKey,
      )

      database = _database
    }

    this.projectDatabases.set(projectId, database)

    return database
  }
}

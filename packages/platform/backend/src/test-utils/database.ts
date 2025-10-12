import type { Logger } from "pino"
import type { BackendDatabase, ProjectDatabase } from "../database/prisma"
import { constants } from "node:fs"
import { access, mkdtemp, rm } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaLibSQL } from "@prisma/adapter-libsql"
import { generateIdentity, identityToRecipient } from "age-encryption"
import { type DatabaseManager, ensureWellKnownEntitiesCreated } from "../database"
import { PrismaClient as BackendPrismaClient } from "../database/_generated/backend/sqlite/client"
import { getInitialBackendUnlockMethodMeta } from "../database/local/backend"
import { migrateDatabase } from "../database/migrate"
import {
  type BackendDatabase as BackendDatabaseClient,
  ProjectDatabase as ProjectDatabaseClient,
} from "../database/prisma"

export class TestDatabaseManager implements DatabaseManager {
  private readonly projectDatabases = new Map<string, Promise<ProjectDatabase>>()
  private readonly tempDirs: string[] = []
  readonly backendUnlockRecipientUpdates: string[][] = []

  constructor(
    readonly backend: BackendDatabase,
    private readonly logger: Logger,
    readonly isEncryptionEnabled: boolean,
  ) {}

  updateBackendUnlockRecipients(recipients: string[]): Promise<void> {
    if (!this.isEncryptionEnabled) {
      return Promise.resolve()
    }

    this.backendUnlockRecipientUpdates.push(recipients)
    return Promise.resolve()
  }

  getProjectMasterKey(): Promise<Buffer | undefined> {
    return Promise.resolve(undefined)
  }

  setupDatabase(projectId: string): Promise<ProjectDatabase> {
    return this.forProject(projectId)
  }

  forProject(projectId: string): Promise<ProjectDatabase> {
    const existingDb = this.projectDatabases.get(projectId)
    if (existingDb) {
      return existingDb
    }

    const projectDb = this._forProject(projectId)
    this.projectDatabases.set(projectId, projectDb)

    return projectDb
  }

  async _forProject(projectId: string): Promise<ProjectDatabase> {
    const tempPath = await this.createTempPath()
    const projectUrl = `file:${join(tempPath, `${projectId}.db`)}`

    await migrateDatabase(projectUrl, "project", undefined, this.logger)

    return new ProjectDatabaseClient({
      adapter: new PrismaLibSQL({ url: projectUrl }),
    })
  }

  static async create(
    logger: Logger,
    options: { isEncryptionEnabled?: boolean } = {},
  ): Promise<TestDatabaseManager> {
    const { isEncryptionEnabled = false } = options
    const tempRoot = await findWritableTempDir()
    const tempPath = await mkdtemp(join(tempRoot, "highstate"))
    const backendUrl = `file:${join(tempPath, "backend.db")}`

    await migrateDatabase(backendUrl, "backend/sqlite", undefined, logger)

    const backend = new BackendPrismaClient({
      adapter: new PrismaLibSQL({ url: backendUrl }),
    }) as BackendDatabaseClient

    await ensureWellKnownEntitiesCreated(backend)

    if (isEncryptionEnabled) {
      const identity = await generateIdentity()
      const recipient = await identityToRecipient(identity)
      const meta = getInitialBackendUnlockMethodMeta(hostname())

      await backend.backendUnlockMethod.create({
        data: {
          recipient,
          meta,
        },
      })
    }

    return new TestDatabaseManager(backend, logger, isEncryptionEnabled)
  }

  private async createTempPath(): Promise<string> {
    const tempRoot = await findWritableTempDir()
    const tempDir = await mkdtemp(join(tempRoot, "highstate"))
    this.tempDirs.push(tempDir)

    return tempDir
  }

  async cleanup(): Promise<void> {
    await this.backend.$disconnect()

    for (const db of this.projectDatabases.values()) {
      const database = await db
      await database.$disconnect()
    }

    for (const tempDir of this.tempDirs) {
      try {
        await rm(tempDir, { recursive: true })
      } catch (error) {
        this.logger.error({ error }, "failed to remove temporary directory")
      }
    }

    this.projectDatabases.clear()
  }
}

async function findWritableTempDir(): Promise<string> {
  const uid = process.getuid?.()
  const candidates = ["/run", uid != null ? `/run/user/${uid}` : undefined, "/tmp"].filter(
    (p): p is string => !!p,
  )

  for (const dir of candidates) {
    try {
      await access(dir, constants.W_OK)
      return dir
    } catch {
      // ignore not writable
    }
  }

  // final fallback
  return tmpdir()
}

import type { Logger } from "pino"
import type { z } from "zod"
import type { ProjectDatabaseBackend } from "../abstractions"
import { mkdir } from "node:fs/promises"
import { PrismaLibSQL } from "@prisma/adapter-libsql"
import { type codebaseConfig, getCodebaseHighstatePath } from "../../common"
import { ProjectDatabase } from "../prisma"

export class LocalProjectDatabaseBackend implements ProjectDatabaseBackend {
  constructor(private readonly highstatePath: string) {}

  async openProjectDatabase(
    projectId: string,
    masterKey?: string,
  ): Promise<[database: ProjectDatabase, url: string]> {
    const databasePath = `${this.highstatePath}/projects/${projectId}`
    await mkdir(databasePath, { recursive: true })

    const databaseUrl = `file:${databasePath}/project.db`

    const adapter = new PrismaLibSQL({
      url: databaseUrl,
      encryptionKey: masterKey,
    })

    const database = new ProjectDatabase({ adapter })

    return [database, databaseUrl]
  }

  static async create(
    config: z.infer<typeof codebaseConfig>,
    logger: Logger,
  ): Promise<LocalProjectDatabaseBackend> {
    const highstatePath = await getCodebaseHighstatePath(config, logger)

    return new LocalProjectDatabaseBackend(highstatePath)
  }
}

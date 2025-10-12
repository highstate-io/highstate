import type { Logger } from "pino"
import type { DatabaseManager } from "../database"
import type { ProjectModelBackend } from "./abstractions"
import { CodebaseProjectModelBackend } from "./backends/codebase"
import { DatabaseProjectModelBackend } from "./backends/database"

export async function createProjectModelBackends(
  database: DatabaseManager,
  logger: Logger,
): Promise<Record<string, ProjectModelBackend>> {
  const codebaseBackend = await CodebaseProjectModelBackend.create(
    logger.child({ backend: "CodebaseProjectModelBackend" }),
  )

  const databaseBackend = new DatabaseProjectModelBackend(
    database,
    logger.child({ backend: "DatabaseProjectModelBackend" }),
  )

  return {
    codebase: codebaseBackend,
    database: databaseBackend,
  }
}

import type { Logger } from "pino"
import type { BackendDatabaseBackend, ProjectDatabaseBackend } from "./abstractions"
import { z } from "zod"
import {
  createLocalBackendDatabaseBackend,
  LocalProjectDatabaseBackend,
  localBackendDatabaseConfig,
} from "./local"
import { databaseManagerConfig } from "./manager"

export const databaseConfig = z.object({
  HIGHSTATE_BACKEND_DATABASE_TYPE: z.enum(["local"]).default("local"),
  HIGHSTATE_PROJECT_DATABASE_TYPE: z.enum(["local"]).default("local"),
  ...localBackendDatabaseConfig.shape,
  ...databaseManagerConfig.shape,
})

export function createBackendDatabaseBackend(
  config: z.infer<typeof databaseConfig>,
  logger: Logger,
): Promise<BackendDatabaseBackend> {
  switch (config.HIGHSTATE_BACKEND_DATABASE_TYPE) {
    case "local":
      return createLocalBackendDatabaseBackend(config, logger)
  }
}

export function createProjectDatabaseBackend(
  config: z.infer<typeof databaseConfig>,
  logger: Logger,
): Promise<ProjectDatabaseBackend> {
  switch (config.HIGHSTATE_PROJECT_DATABASE_TYPE) {
    case "local":
      return LocalProjectDatabaseBackend.create(config, logger)
  }
}

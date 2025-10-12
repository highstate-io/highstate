import { z } from "zod"
import { artifactBackendConfig } from "./artifact"
import { projectUnlockServiceConfig } from "./business"
import { codebaseConfig } from "./common"
import { databaseConfig } from "./database"
import { libraryBackendConfig } from "./library"
import { lockBackendConfig } from "./lock"
import { pubSubBackendConfig } from "./pubsub"
import { runnerBackendConfig } from "./runner"
import { terminalBackendConfig } from "./terminal"
import { workerBackendConfig, workerManagerConfig } from "./worker"

const loggerConfig = z.object({
  HIGHSTATE_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
})

const configSchema = z.object({
  ...codebaseConfig.shape,
  ...databaseConfig.shape,
  ...pubSubBackendConfig.shape,
  ...lockBackendConfig.shape,
  ...libraryBackendConfig.shape,
  ...projectUnlockServiceConfig.shape,
  ...runnerBackendConfig.shape,
  ...terminalBackendConfig.shape,
  ...workerBackendConfig.shape,
  ...workerManagerConfig.shape,
  ...artifactBackendConfig.shape,
  ...loggerConfig.shape,
})

export type Config = z.infer<typeof configSchema>

export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  useDotenv = true,
): Promise<Config> {
  if (useDotenv) {
    await import("dotenv/config")
  }

  try {
    return configSchema.parse(env)
  } catch (error) {
    throw new Error("Failed to parse backend configuration", { cause: error })
  }
}

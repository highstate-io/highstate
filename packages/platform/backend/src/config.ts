import { z } from "zod"
import { artifactBackendConfig } from "./artifact"
import { projectUnlockServiceConfig } from "./business"
import { codebaseConfig } from "./common"
import { databaseConfig } from "./database"
import { libraryBackendConfig, selectedLibraryPackagesSchema } from "./library"
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
  HIGHSTATE_PUBLIC_API_URL: z.url().default("http://api.highstate.localhost:3000"),
  HIGHSTATE_INITIAL_LIBRARY_PACKAGES: z
    .string()
    .transform((value, context) => {
      try {
        return JSON.parse(value) as unknown
      } catch {
        context.addIssue({ code: "custom", message: "Expected a JSON array of library packages" })
        return z.NEVER
      }
    })
    .pipe(selectedLibraryPackagesSchema)
    .default([{ packageName: "@highstate/library", version: "0.30.2" }]),
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

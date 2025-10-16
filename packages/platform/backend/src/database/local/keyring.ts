import type { Logger } from "pino"
import { readFile } from "node:fs/promises"
import { AsyncEntry, findCredentialsAsync } from "@napi-rs/keyring"
import { generateIdentity } from "age-encryption"
import { z } from "zod"

const serviceName = "io.highstate.backend"
const accountName = "identity"

export const backendIdentityConfig = z.object({
  HIGHSTATE_BACKEND_DATABASE_IDENTITY: z.string().optional(),
  HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH: z.string().optional(),
})

export type BackendIdentityConfig = z.infer<typeof backendIdentityConfig>

/**
 * Retrieves or creates the backend identity for database encryption.
 *
 * The identity can be loaded from multiple sources in this priority order:
 * 1. Environment variable HIGHSTATE_BACKEND_DATABASE_IDENTITY (direct identity string)
 * 2. Environment variable HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH (path to identity file)
 * 3. OS keyring (default behavior - creates new identity if not found)
 *
 * When using environment variables, the OS keyring is bypassed entirely.
 * This is useful for environments where OS keyring is not available or for automation.
 *
 * @param config Configuration object containing optional identity environment variables.
 * @param logger Logger instance for recording identity source and operations.
 * @returns The AGE identity string used to decrypt the backend master key.
 */
export async function getOrCreateBackendIdentity(
  config: BackendIdentityConfig,
  logger: Logger,
): Promise<string> {
  // priority 1: direct identity from environment variable
  if (config.HIGHSTATE_BACKEND_DATABASE_IDENTITY) {
    logger.info("using backend identity from HIGHSTATE_BACKEND_DATABASE_IDENTITY")
    return config.HIGHSTATE_BACKEND_DATABASE_IDENTITY
  }

  // priority 2: identity from file path specified in environment variable
  if (config.HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH) {
    try {
      const identity = await readFile(config.HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH, "utf-8")
      logger.info(
        `using backend identity from path specified in HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH`,
      )
      return identity.trim()
    } catch (error) {
      throw new Error(
        `Failed to read backend identity from "${config.HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH}"`,
        { cause: error },
      )
    }
  }

  // priority 3: OS keyring (default behavior)
  const credentials = await findCredentialsAsync(serviceName)
  const entry = credentials.find(entry => entry.account === accountName)

  if (entry) {
    logger.info("using backend identity from OS keyring")
    return entry.password
  }

  const newIdentity = await generateIdentity()
  await new AsyncEntry(serviceName, accountName).setPassword(newIdentity)

  logger.info("created new backend identity and stored it in the OS keyring")
  return newIdentity
}

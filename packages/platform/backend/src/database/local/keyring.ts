import type { Logger } from "pino"
import { AsyncEntry, findCredentialsAsync } from "@napi-rs/keyring"
import { generateIdentity } from "age-encryption"

const serviceName = "io.highstate.backend"
const accountName = "identity"

export async function getOrCreateBackendIdentity(logger: Logger): Promise<string> {
  const credentials = await findCredentialsAsync(serviceName)
  const entry = credentials.find(entry => entry.account === accountName)

  if (entry) {
    logger.debug("found existing backend identity in keyring")
    return entry.password
  }

  const newIdentity = await generateIdentity()
  await new AsyncEntry(serviceName, accountName).setPassword(newIdentity)

  logger.info("created new backend identity and stored it in the OS keyring")
  return newIdentity
}

import { hostname } from "node:os"
import { identityToRecipient } from "age-encryption"
import { Command } from "clipanion"
import { logger } from "../../shared"

export class BackendIdentityCommand extends Command {
  static paths = [["backend", "identity"]]

  static usage = Command.Usage({
    category: "Backend",
    description: "Ensures the backend identity is set up and returns the recipient.",
  })

  async execute(): Promise<void> {
    // do not initialize the backend services here, because the state might not be available yet
    const { getOrCreateBackendIdentity } = await import("@highstate/backend")

    const backendIdentity = await getOrCreateBackendIdentity(logger)
    const recipient = await identityToRecipient(backendIdentity)

    logger.info(`stored backend identity: "%s"`, recipient)

    const suggestedTitle = hostname()

    if (!suggestedTitle) {
      logger.info(`run "highstate backend unlock-method add %s" on a trusted device`, recipient)
      return
    }

    logger.info(
      `run "highstate backend unlock-method add %s --title %s" on a trusted device`,
      recipient,
      suggestedTitle,
    )
  }
}

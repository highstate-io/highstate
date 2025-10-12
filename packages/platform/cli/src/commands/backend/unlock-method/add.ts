import { disposeServices } from "@highstate/backend"
import { input } from "@inquirer/prompts"
import { Command, Option } from "clipanion"
import { getBackendServices, logger } from "../../../shared"

export class BackendUnlockMethodAddCommand extends Command {
  static paths = [["backend", "unlock-method", "add"]]

  static usage = Command.Usage({
    category: "Backend",
    description: "Adds a new backend unlock method for the current workspace.",
    examples: [["Add recipient", "highstate backend unlock-method add age1example --title Laptop"]],
  })

  recipient = Option.String()
  title = Option.String("--title")
  description = Option.String("--description")

  async execute(): Promise<void> {
    let title = this.title
    if (!title) {
      title = await input({
        message: "Unlock Method Title",
        default: "New Device",
        validate: value => (value.trim().length > 0 ? true : "Title is required"),
      })
    }

    let description = this.description
    if (description === undefined) {
      description = await input({
        message: "Description (optional)",
        default: "",
      })
    }

    const services = await getBackendServices()

    try {
      const result = await services.backendUnlockService.addUnlockMethod({
        recipient: this.recipient,
        meta: description
          ? { title: title.trim(), description: description.trim() }
          : { title: title.trim() },
      })

      logger.info(`added backend unlock method "%s"`, result.id)
    } finally {
      await disposeServices(services)
    }

    // TODO: investigate why this is needed to properly exit
    process.exit(0)
  }
}

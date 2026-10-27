import { confirm } from "@inquirer/prompts"
import { Command, Option } from "clipanion"
import { disposeServices, getBackendServices, logger } from "../../../shared"

export class BackendUnlockMethodDeleteCommand extends Command {
  static paths = [["backend", "unlock-method", "delete"]]

  static usage = Command.Usage({
    category: "Backend",
    description: "Removes a backend unlock method by its identifier.",
  })

  id = Option.String()
  force = Option.Boolean("--force", false)

  async execute(): Promise<void> {
    if (!this.force) {
      const answer = await confirm({
        message: `Delete backend unlock method ${this.id}?`,
        default: false,
      })

      if (!answer) {
        logger.info("cancelled backend unlock method deletion")
        return
      }
    }

    const services = await getBackendServices()

    try {
      await services.backendUnlockService.deleteUnlockMethod(this.id)
      logger.info(`deleted backend unlock method "%s"`, this.id)
    } finally {
      await disposeServices()
    }

    process.exit(0)
  }
}

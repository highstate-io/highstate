import { disposeServices } from "@highstate/backend"
import { Command } from "clipanion"
import { Table } from "console-table-printer"
import { getBackendServices, logger } from "../../../shared"

export class BackendUnlockMethodListCommand extends Command {
  static paths = [["backend", "unlock-method", "list"]]

  static usage = Command.Usage({
    category: "Backend",
    description: "Lists backend unlock methods registered for the current workspace.",
  })

  async execute(): Promise<void> {
    const services = await getBackendServices()

    try {
      const methods = await services.backendUnlockService.listUnlockMethods()

      if (methods.length === 0) {
        logger.warn("no backend unlock methods configured")
        return
      }

      const table = new Table({
        columns: [
          { name: "title", title: "Title" },
          { name: "id", title: "ID" },
          { name: "recipient", title: "Recipient" },
          { name: "description", title: "Description", maxLen: 30 },
        ],
        defaultColumnOptions: {
          alignment: "left",
        },
      })

      table.addRows(
        methods.map(method => ({
          title: method.meta.title,
          id: method.id,
          recipient: method.recipient,
          description: method.meta.description ?? "",
        })),
      )

      table.printTable()
    } finally {
      await disposeServices(services)
    }

    process.exit(0)
  }
}

import { Command } from "clipanion"
import { Table } from "console-table-printer"
import { findWorkspaceRoot, logger, scanWorkspacePackages } from "../../shared"

export class PackageListCommand extends Command {
  static paths = [["package", "list"]]

  static usage = Command.Usage({
    category: "Package",
    description: "Lists all packages in the workspace with their types.",
  })

  async execute(): Promise<void> {
    const workspaceRoot = await findWorkspaceRoot()
    const packages = await scanWorkspacePackages(workspaceRoot)

    if (packages.length === 0) {
      logger.info("no packages found in workspace")
      return
    }

    const table = new Table({
      columns: [
        { name: "name", title: "Name" },
        { name: "type", title: "Type" },
        { name: "path", title: "Path" },
      ],
    })

    table.addRows(
      packages.map(pkg => ({
        name: pkg.name,
        type: pkg.type ?? "unknown",
        path: pkg.relativePath,
      })),
    )

    table.printTable()
  }
}

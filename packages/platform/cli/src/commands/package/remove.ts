import { rm } from "node:fs/promises"
import { Command, Option } from "clipanion"
import {
  findWorkspaceRoot,
  logger,
  scanWorkspacePackages,
  updateTsconfigReferences,
} from "../../shared"

export class RemoveCommand extends Command {
  static paths = [["package", "remove"]]

  static usage = Command.Usage({
    category: "Package",
    description: "Removes a package from the workspace.",
  })

  name = Option.String({ required: true })

  async execute(): Promise<void> {
    const workspaceRoot = await findWorkspaceRoot()
    const packages = await scanWorkspacePackages(workspaceRoot)

    const targetPackage = packages.find(
      pkg =>
        pkg.name === this.name ||
        pkg.name === `@highstate/${this.name}` ||
        pkg.relativePath.endsWith(this.name),
    )

    if (!targetPackage) {
      logger.error(`package not found: ${this.name}`)
      process.exit(1)
    }

    // remove the package directory
    await rm(targetPackage.path, { recursive: true, force: true })

    // update tsconfig references
    const remainingPackages = await scanWorkspacePackages(workspaceRoot)
    await updateTsconfigReferences(workspaceRoot, remainingPackages)

    logger.info(`removed package: ${targetPackage.name}`)
  }
}

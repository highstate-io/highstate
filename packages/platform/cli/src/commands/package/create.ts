import { Command, Option } from "clipanion"
import {
  createPackage,
  findWorkspaceRoot,
  highstateConfigSchema,
  logger,
  scanWorkspacePackages,
  updateTsconfigReferences,
} from "../../shared"

export class PackageCreateCommand extends Command {
  static paths = [["package", "create"]]

  static usage = Command.Usage({
    category: "Package",
    description: "Creates a new package in the workspace.",
  })

  name = Option.String({ required: true })
  type = Option.String("--type,-t", {
    description: "Package type (source, library, worker)",
  })

  async execute(): Promise<void> {
    const workspaceRoot = await findWorkspaceRoot()
    const packageType = highstateConfigSchema.shape.type.parse(this.type)

    await createPackage(workspaceRoot, this.name, packageType)

    // update tsconfig references
    const packages = await scanWorkspacePackages(workspaceRoot)
    await updateTsconfigReferences(workspaceRoot, packages)

    logger.info(`created package: @highstate/${this.name} (${packageType})`)
  }
}

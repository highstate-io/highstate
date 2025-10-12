import { Command } from "clipanion"
import { findWorkspaceRoot, scanWorkspacePackages, updateTsconfigReferences } from "../../shared"

export class UpdateReferencesCommand extends Command {
  static paths = [["package", "update-references"]]

  static usage = Command.Usage({
    category: "Package",
    description: "Updates the root tsconfig.json with references to all packages in the workspace.",
  })

  async execute(): Promise<void> {
    const workspaceRoot = await findWorkspaceRoot()
    const packages = await scanWorkspacePackages(workspaceRoot)

    await updateTsconfigReferences(workspaceRoot, packages, true)
  }
}

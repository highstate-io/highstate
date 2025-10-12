import { Builtins, Cli } from "clipanion"
import { version } from "../package.json"
import { BackendIdentityCommand } from "./commands/backend/identity"
import { BackendUnlockMethodAddCommand } from "./commands/backend/unlock-method/add"
import { BackendUnlockMethodDeleteCommand } from "./commands/backend/unlock-method/delete"
import { BackendUnlockMethodListCommand } from "./commands/backend/unlock-method/list"
import { BuildCommand } from "./commands/build"
import { DesignerCommand } from "./commands/designer"
import {
  CreateCommand as PackageCreateCommand,
  ListCommand as PackageListCommand,
  RemoveCommand as PackageRemoveCommand,
  UpdateReferencesCommand,
} from "./commands/package"

const cli = new Cli({
  binaryName: "highstate",
  binaryLabel: "Highstate",
  binaryVersion: version,
})

cli.register(BuildCommand)
cli.register(DesignerCommand)
cli.register(BackendIdentityCommand)
cli.register(BackendUnlockMethodListCommand)
cli.register(BackendUnlockMethodAddCommand)
cli.register(BackendUnlockMethodDeleteCommand)
cli.register(UpdateReferencesCommand)
cli.register(PackageListCommand)
cli.register(PackageCreateCommand)
cli.register(PackageRemoveCommand)
cli.register(Builtins.HelpCommand)
cli.register(Builtins.VersionCommand)

await cli.runExit(process.argv.slice(2))

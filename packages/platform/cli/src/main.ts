import { Builtins, Cli } from "clipanion"
import { BackendIdentityCommand } from "./commands/backend/identity"
import { BackendUnlockMethodAddCommand } from "./commands/backend/unlock-method/add"
import { BackendUnlockMethodDeleteCommand } from "./commands/backend/unlock-method/delete"
import { BackendUnlockMethodListCommand } from "./commands/backend/unlock-method/list"
import { BuildCommand } from "./commands/build"
import { DesignerCommand } from "./commands/designer"
import { InitCommand } from "./commands/init"
import { PackageCreateCommand } from "./commands/package/create"
import { PackageListCommand } from "./commands/package/list"
import { PackageRemoveCommand } from "./commands/package/remove"
import { PackageUpdateReferencesCommand } from "./commands/package/update-references"
import { UpdateCommand } from "./commands/update"
import { readCurrentPackageVersion } from "./shared"

const version = await readCurrentPackageVersion(import.meta.url)

const cli = new Cli({
  binaryName: "highstate",
  binaryLabel: "Highstate",
  binaryVersion: version,
})

cli.register(BuildCommand)
cli.register(DesignerCommand)
cli.register(InitCommand)
cli.register(UpdateCommand)
cli.register(BackendIdentityCommand)
cli.register(BackendUnlockMethodListCommand)
cli.register(BackendUnlockMethodAddCommand)
cli.register(BackendUnlockMethodDeleteCommand)
cli.register(PackageUpdateReferencesCommand)
cli.register(PackageListCommand)
cli.register(PackageCreateCommand)
cli.register(PackageRemoveCommand)
cli.register(Builtins.HelpCommand)
cli.register(Builtins.VersionCommand)

const args = process.argv.slice(2)

if (args[0] !== "build") {
  const { default: registerRemoteCommands } = await import("./register-remote-commands")

  registerRemoteCommands(cli)
}

await cli.runExit(args)

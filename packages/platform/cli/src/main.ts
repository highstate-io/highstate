import { Builtins, Cli } from "clipanion"
import {
  BackendIdentityCommand,
  BackendUnlockMethodAddCommand,
  BackendUnlockMethodDeleteCommand,
  BackendUnlockMethodListCommand,
  BuildCommand,
  DesignerCommand,
  InitCommand,
  PackageCreateCommand,
  PackageListCommand,
  PackageRemoveCommand,
  PackageUpdateReferencesCommand,
  UpdateCommand,
} from "./commands"

// const { version } = await import("@highstate/cli/package.json")

const cli = new Cli({
  binaryName: "highstate",
  binaryLabel: "Highstate",
  // binaryVersion: version,
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

await cli.runExit(process.argv.slice(2))

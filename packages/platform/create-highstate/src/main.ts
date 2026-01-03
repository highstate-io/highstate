import { InitCommand } from "@highstate/cli/commands"
import { Builtins, Cli } from "clipanion"

const { version } = await import("create-highstate/package.json")

const cli = new Cli({
  binaryName: "create-highstate",
  binaryLabel: "Highstate Starter",
  binaryVersion: version,
})

class RootCommand extends InitCommand {
  static paths = [[]]
}

cli.register(RootCommand)
cli.register(Builtins.HelpCommand)
cli.register(Builtins.VersionCommand)

await cli.runExit(process.argv.slice(2))

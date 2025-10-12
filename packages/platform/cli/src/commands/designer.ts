import { Command, UsageError } from "clipanion"
import { consola } from "consola"
import { colorize } from "consola/utils"
import { getPort } from "get-port-please"
import { addDevDependency } from "nypm"
import { readPackageJSON } from "pkg-types"
import { getBackendServices, logger } from "../shared"

export class DesignerCommand extends Command {
  static paths = [["designer"]]

  static usage = Command.Usage({
    category: "Designer",
    description: "Starts the Highstate designer in the current project.",
  })

  async execute(): Promise<void> {
    const packageJson = await readPackageJSON()
    if (!packageJson.devDependencies?.["@highstate/cli"]) {
      throw new UsageError(
        "This project is not a Highstate project.\n@highstate/cli must be installed as a devDependency.",
      )
    }

    if (!packageJson.devDependencies?.["@highstate/designer"]) {
      logger.info("Installing @highstate/designer...")

      await addDevDependency(["@highstate/designer", "classic-level"])
    }

    logger.info("starting highstate designer...")

    await getBackendServices()

    const oldConsoleLog = console.log

    const port = await getPort()

    process.env.NITRO_PORT = port.toString()
    process.env.NITRO_HOST = "0.0.0.0"

    await new Promise<void>(resolve => {
      console.log = (message: string) => {
        if (message.startsWith("Listening on")) {
          resolve()
        }
      }

      const path = "@highstate/designer/.output/server/index.mjs"
      void import(path)
    })

    console.log = oldConsoleLog

    consola.log(
      [
        "\n  ",
        colorize("bold", colorize("cyanBright", "Highstate Designer")),
        "\n  ",
        colorize("greenBright", "➜ Local:  "),
        colorize("underline", colorize("cyanBright", `http://localhost:${port}`)),
        "\n",
      ].join(""),
    )

    process.on("SIGINT", () => {
      process.stdout.write("\r")
      consola.info("shutting down highstate designer...")

      setTimeout(() => process.exit(0), 1000)
    })
  }
}

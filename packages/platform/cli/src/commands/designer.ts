import { pathToFileURL } from "node:url"
import { Command, UsageError } from "clipanion"
import { consola } from "consola"
import { colorize } from "consola/utils"
import { checkPort, getPort } from "get-port-please"
import { resolve as importMetaResolve } from "import-meta-resolve"
import { addDevDependency } from "nypm"
import { readPackageJSON, resolvePackageJSON } from "pkg-types"
import { getBackendServices, logger } from "../shared"

let shuttingDown = false

export class DesignerCommand extends Command {
  static paths = [["designer"]]

  static usage = Command.Usage({
    category: "Designer",
    description: "Starts the Highstate designer in the current project.",
  })

  async execute(): Promise<void> {
    const packageJsonPath = await resolvePackageJSON()
    const packageJsonUrl = pathToFileURL(packageJsonPath).toString()
    const packageJson = await readPackageJSON(packageJsonPath)

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

    const host = "127.0.0.1"
    const configuredPort = process.env.HIGHSTATE_DESIGNER_PORT
    const port = configuredPort === undefined ? 7283 : Number(configuredPort)
    if (!/^\d+$/.test(configuredPort ?? port.toString()) || port < 1 || port > 65535) {
      throw new UsageError(`HIGHSTATE_DESIGNER_PORT must be an integer between "1" and "65535"`)
    }

    if (configuredPort !== undefined) {
      logger.warn(
        `using custom designer port "%s"; changing the port changes the WebAuthn origin and may require registering security keys again`,
        port,
      )
    }

    const availablePort = await checkPort(port, host)
    if (!availablePort) {
      throw new UsageError(`Port "${port}" is already in use`)
    }

    const eventsPort = await getPort({ random: true, host })

    const designerPackageJsonPath = importMetaResolve(
      "@highstate/designer/package.json",
      packageJsonUrl,
    )
    const designerPackageJson = await readPackageJSON(designerPackageJsonPath)

    process.env.NITRO_PORT = port.toString()
    process.env.NITRO_HOST = host
    process.env.NITRO_BUN_IDLE_TIMEOUT ??= "255"
    process.env.NUXT_PUBLIC_VERSION = designerPackageJson.version
    process.env.NUXT_PUBLIC_EVENTS_PORT = eventsPort.toString()

    try {
      await new Promise<void>((resolve, reject) => {
        console.log = (message: string) => {
          if (message.startsWith("Listening on")) {
            if (!message.includes(`http://${host}:${port}`)) {
              reject(new Error(`Designer started on an unexpected endpoint: ${message}`))
              return
            }

            resolve()
          }
        }

        const serverPath = importMetaResolve("@highstate/designer/server", packageJsonUrl)
        void import(serverPath).catch(reject)
      })
    } finally {
      console.log = oldConsoleLog
    }

    consola.log(
      [
        "\n  ",
        colorize("bold", colorize("cyanBright", "Highstate Designer")),
        "\n  ",
        colorize("greenBright", "➜ Local:  "),
        colorize("underline", colorize("cyanBright", `http://highstate.localhost:${port}`)),
        "\n",
      ].join(""),
    )

    process.once("SIGINT", () => {
      if (shuttingDown) {
        return
      }
      shuttingDown = true

      process.stdout.write("\r")
      consola.info("shutting down highstate designer...")

      setTimeout(() => process.exit(0), 1000)
    })
  }
}

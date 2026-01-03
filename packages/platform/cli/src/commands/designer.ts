import { pathToFileURL } from "node:url"
import { Command, UsageError } from "clipanion"
import { consola } from "consola"
import { colorize } from "consola/utils"
import { getPort } from "get-port-please"
import { resolve as importMetaResolve } from "import-meta-resolve"
import { addDevDependency, detectPackageManager } from "nypm"
import { readPackageJSON, resolvePackageJSON } from "pkg-types"
import {
  getBackendServices,
  getProjectPulumiSdkVersion,
  getPulumiCliVersion,
  logger,
} from "../shared"

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

    const projectRoot = process.cwd()
    const detected = await detectPackageManager(projectRoot)
    const packageManager = detected?.name

    if (packageManager === "npm" || packageManager === "pnpm" || packageManager === "yarn") {
      const expectedPulumiSdk = await getProjectPulumiSdkVersion(projectRoot, { packageManager })
      const actualPulumiCli = await getPulumiCliVersion(projectRoot)

      if (expectedPulumiSdk && actualPulumiCli && expectedPulumiSdk !== actualPulumiCli) {
        logger.warn(
          `pulumi version mismatch detected, this may cause incompatibilities\nexpected "%s" (from overrides for "@pulumi/pulumi"), got "%s" (from "pulumi version")\nrecommended: run "highstate update" or downgrade your Pulumi CLI to "%s"`,
          expectedPulumiSdk,
          actualPulumiCli,
          expectedPulumiSdk,
        )
      }
    }

    logger.info("starting highstate designer...")

    await getBackendServices()

    const oldConsoleLog = console.log

    const port = await getPort({ port: 3000 })
    const eventsPort = await getPort({ port: 3001 })

    const designerPackageJsonPath = importMetaResolve(
      "@highstate/designer/package.json",
      packageJsonUrl,
    )
    const designerPackageJson = await readPackageJSON(designerPackageJsonPath)

    process.env.NITRO_PORT = port.toString()
    process.env.NITRO_HOST = "0.0.0.0"
    process.env.NUXT_PUBLIC_VERSION = designerPackageJson.version
    process.env.NUXT_PUBLIC_EVENTS_PORT = eventsPort.toString()

    await new Promise<void>(resolve => {
      console.log = (message: string) => {
        if (message.startsWith("Listening on")) {
          resolve()
        }
      }

      const serverPath = importMetaResolve("@highstate/designer/server", packageJsonUrl)
      void import(serverPath)
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

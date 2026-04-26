import { access, mkdir, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { input } from "@inquirer/prompts"
import { Command, Option } from "clipanion"
import { installDependencies } from "nypm"
import {
  applyOverrides,
  buildOverrides,
  generateFromTemplate,
  logger,
  resolveVersionBundle,
} from "../shared"

export class InitCommand extends Command {
  static paths = [["init"]]

  static usage = Command.Usage({
    description: "Initializes a new Highstate project.",
  })

  pathOption = Option.String("--path,-p", {
    description: "The path where the project should be initialized.",
  })

  name = Option.String("--name", {
    description: "The project name.",
  })

  platformVersion = Option.String("--platform-version", {
    description: "The Highstate platform version to use.",
  })

  stdlibVersion = Option.String("--stdlib-version", {
    description: "The Highstate standard library version to use.",
  })

  async execute(): Promise<void> {
    const isBunAvailable = await isExecutableInPath("bun")
    if (!isBunAvailable) {
      throw new Error('Required package manager "bun" was not found in PATH')
    }

    const projectName = await resolveProjectName(this.name)
    const destinationPath = await resolveDestinationPath(this.pathOption, projectName)

    const templatePath = resolveTemplatePath()

    const versionBundle = await resolveVersionBundle({
      platformVersion: this.platformVersion,
      stdlibVersion: this.stdlibVersion,
    })

    await mkdir(destinationPath, { recursive: true })

    const isEmptyOrMissing = await isEmptyDirectory(destinationPath)
    if (!isEmptyOrMissing) {
      throw new Error(`Destination path is not empty: "${destinationPath}"`)
    }

    logger.info("initializing highstate project in %s", destinationPath)

    await generateFromTemplate(templatePath, destinationPath, {
      projectName,
      packageName: projectName,
      platformVersion: versionBundle.platformVersion,
      libraryVersion: versionBundle.stdlibVersion,
    })

    const overrides = buildOverrides(versionBundle)
    await applyOverrides({
      projectRoot: destinationPath,
      overrides,
    })

    logger.info("installing dependencies using bun...")

    await installDependencies({
      cwd: destinationPath,
      packageManager: "bun",
      silent: false,
    })

    logger.info("project initialized successfully")
  }
}

async function resolveDestinationPath(
  pathOption: string | undefined,
  projectName: string,
): Promise<string> {
  if (pathOption) {
    return resolve(pathOption)
  }

  const defaultPath = resolve(process.cwd(), projectName)

  const pathValue = await input({
    message: "Project path",
    default: defaultPath,
    validate: value => (value.trim().length > 0 ? true : "Path is required"),
  })

  return resolve(pathValue)
}

async function resolveProjectName(nameOption: string | undefined): Promise<string> {
  if (nameOption !== undefined) {
    const trimmed = nameOption.trim()
    if (trimmed.length === 0) {
      throw new Error('Flag "--name" must not be empty')
    }

    return trimmed
  }

  const value = await input({
    message: "Project name",
    default: "my-project",
    validate: inputValue => (inputValue.trim().length > 0 ? true : "Name is required"),
  })

  return value.trim()
}

async function isExecutableInPath(command: string): Promise<boolean> {
  const pathValue = process.env.PATH
  if (!pathValue) {
    return false
  }

  const parts = pathValue.split(":").filter(Boolean)
  for (const part of parts) {
    const candidate = resolve(part, command)
    try {
      await access(candidate)
      return true
    } catch {
      // ignore
    }
  }

  return false
}

async function isEmptyDirectory(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path)
    return entries.length === 0
  } catch {
    return true
  }
}

function resolveTemplatePath(): string {
  const here = fileURLToPath(new URL(import.meta.url))
  return resolve(here, "..", "..", "assets", "template")
}

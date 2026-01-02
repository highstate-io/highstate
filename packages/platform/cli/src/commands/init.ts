import type { PackageManagerName } from "nypm"
import { access, mkdir, readdir } from "node:fs/promises"
import { basename, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { input, select } from "@inquirer/prompts"
import { Command, Option } from "clipanion"
import { installDependencies } from "nypm"
import { generateFromTemplate, logger } from "../shared"

export class InitCommand extends Command {
  static paths = [["init"]]

  static usage = Command.Usage({
    description: "Initializes a new Highstate project.",
  })

  pathOption = Option.String("--path,-p", {
    description: "The path where the project should be initialized.",
  })

  packageManager = Option.String("--package-manager", {
    description: "The package manager to use (npm, yarn, pnpm).",
  })

  name = Option.String("--name", {
    description: "The project name.",
  })

  private static readonly defaultPlatformVersion = "0.14.0"
  private static readonly defaultLibraryVersion = "0.14.0"

  async execute(): Promise<void> {
    const availablePackageManagers = await detectAvailablePackageManagers(["npm", "pnpm", "yarn"])
    if (availablePackageManagers.length === 0) {
      throw new Error("no supported package managers found in PATH (npm, pnpm, yarn)")
    }

    const destinationPath = await resolveDestinationPath(this.pathOption)
    const defaultName = basename(destinationPath)

    const projectName = await resolveProjectName(this.name, defaultName)

    const selectedPackageManager = await resolvePackageManager(
      this.packageManager,
      availablePackageManagers,
    )

    const templatePath = resolveTemplatePath()

    await mkdir(destinationPath, { recursive: true })

    const isEmptyOrMissing = await isEmptyDirectory(destinationPath)
    if (!isEmptyOrMissing) {
      throw new Error(`destination path is not empty: ${destinationPath}`)
    }

    logger.info("initializing highstate project in %s", destinationPath)

    await generateFromTemplate(templatePath, destinationPath, {
      projectName,
      packageName: projectName,
      platformVersion: InitCommand.defaultPlatformVersion,
      libraryVersion: InitCommand.defaultLibraryVersion,
      isPnpm: selectedPackageManager === "pnpm" ? "true" : "",
      isYarn: selectedPackageManager === "yarn" ? "true" : "",
    })

    logger.info("installing dependencies using %s...", selectedPackageManager)

    await installDependencies({
      cwd: destinationPath,
      packageManager: selectedPackageManager,
      silent: false,
    })

    logger.info("project initialized successfully")
  }
}

async function resolveDestinationPath(pathOption: string | undefined): Promise<string> {
  if (pathOption) {
    return resolve(pathOption)
  }

  const pathValue = await input({
    message: "Project path",
    default: ".",
    validate: value => (value.trim().length > 0 ? true : "Path is required"),
  })

  return resolve(pathValue)
}

async function resolveProjectName(
  nameOption: string | undefined,
  defaultName: string,
): Promise<string> {
  if (nameOption) {
    return nameOption.trim()
  }

  const value = await input({
    message: "Project name",
    default: defaultName,
    validate: inputValue => (inputValue.trim().length > 0 ? true : "Name is required"),
  })

  return value.trim()
}

async function resolvePackageManager(
  packageManagerOption: string | undefined,
  available: PackageManagerName[],
): Promise<PackageManagerName> {
  if (packageManagerOption) {
    if (!isSupportedPackageManagerName(packageManagerOption)) {
      throw new Error(`unsupported package manager: ${packageManagerOption}`)
    }

    const name = packageManagerOption
    if (!available.includes(name)) {
      throw new Error(`package manager not found in PATH: ${name}`)
    }

    return name
  }

  const preferredOrder: PackageManagerName[] = ["pnpm", "yarn", "npm"]
  const defaultValue = preferredOrder.find(value => available.includes(value)) ?? available[0]

  return await select({
    message: "Package manager",
    default: defaultValue,
    choices: available.map(value => ({ name: value, value })),
  })
}

function isSupportedPackageManagerName(value: string): value is PackageManagerName {
  return value === "npm" || value === "pnpm" || value === "yarn"
}

async function detectAvailablePackageManagers(
  candidates: PackageManagerName[],
): Promise<PackageManagerName[]> {
  const results: PackageManagerName[] = []

  for (const candidate of candidates) {
    const exists = await isExecutableInPath(candidate)
    if (exists) {
      results.push(candidate)
    }
  }

  return results
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

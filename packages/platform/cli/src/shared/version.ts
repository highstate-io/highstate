import { readFile } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"

type PackageManifest = {
  version?: string
}

export async function readCurrentPackageVersion(moduleUrl: string): Promise<string> {
  let directory = dirname(
    moduleUrl.startsWith("file:")
      ? fileURLToPath(moduleUrl)
      : isAbsolute(moduleUrl)
        ? moduleUrl
        : process.cwd(),
  )

  while (true) {
    const packageJsonPath = join(directory, "package.json")

    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageManifest

      if (!packageJson.version) {
        throw new Error(`Package version is missing from "${packageJsonPath}"`)
      }

      return packageJson.version
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error && error.code === "ENOENT")) {
        throw error
      }
    }

    const parentDirectory = dirname(directory)
    if (parentDirectory === directory) {
      throw new Error(`Package manifest not found above "${directory}"`)
    }

    directory = parentDirectory
  }
}

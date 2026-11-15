import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export async function resolvePackageAsset(
  moduleUrl: string,
  packageName: string,
  ...assetPath: string[]
): Promise<string> {
  let directory = dirname(fileURLToPath(moduleUrl))

  while (true) {
    const packageJsonPath = join(directory, "package.json")

    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { name?: string }
      if (packageJson.name === packageName) {
        return join(directory, ...assetPath)
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error && error.code === "ENOENT")) {
        throw error
      }
    }

    const parentDirectory = dirname(directory)
    if (parentDirectory === directory) {
      throw new Error(`Package "${packageName}" not found above "${directory}"`)
    }

    directory = parentDirectory
  }
}

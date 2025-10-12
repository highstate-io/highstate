import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { z } from "zod"
import { highstateConfigSchema } from "./schemas"

/**
 * Represents a Highstate package in the workspace
 */
export interface HighstatePackage {
  /** Absolute path to the package directory */
  path: string
  /** Relative path from workspace root */
  relativePath: string
  /** Package name from package.json */
  name: string
  /** Package type from highstate config */
  type?: "source" | "library" | "worker"
}

/**
 * Schema for package.json files
 */
const packageJsonSchema = z.object({
  name: z.string(),
  highstate: highstateConfigSchema.optional(),
})

/**
 * Generates tsconfig content with correct relative path based on package depth
 */
function generateTsconfigContent(workspaceRoot: string, packagePath: string) {
  const relativePath = relative(workspaceRoot, packagePath)
  const depth = relativePath.split("/").length
  const relativeNodeModules = `${"../".repeat(depth)}node_modules/@highstate/cli/assets/tsconfig.base.json`

  return {
    extends: relativeNodeModules,
    include: ["./src/**/*.ts", "./package.json", "./assets/**/*.json"],
  }
}

/**
 * Finds the workspace root by looking for package.json with workspaces
 */
export async function findWorkspaceRoot(startPath: string = process.cwd()): Promise<string> {
  let currentPath = resolve(startPath)

  while (currentPath !== "/") {
    const packageJsonPath = join(currentPath, "package.json")

    if (existsSync(packageJsonPath)) {
      try {
        const content = await readFile(packageJsonPath, "utf-8")
        const packageJson = JSON.parse(content) as { workspaces?: unknown }

        if (packageJson.workspaces) {
          return currentPath
        }
      } catch {
        // ignore invalid package.json files
      }
    }

    const parentPath = resolve(currentPath, "..")
    if (parentPath === currentPath) break
    currentPath = parentPath
  }

  throw new Error("Could not find workspace root (no package.json with workspaces found)")
}

/**
 * Recursively scans for packages in the workspace
 */
export async function scanWorkspacePackages(workspaceRoot: string): Promise<HighstatePackage[]> {
  const packages: HighstatePackage[] = []
  const packagesDir = join(workspaceRoot, "packages")

  if (!existsSync(packagesDir)) {
    return packages
  }

  async function scanDirectory(dirPath: string, depth = 0): Promise<void> {
    // skip node_modules and hidden directories at any depth
    const dirName = relative(packagesDir, dirPath).split("/").pop()
    if (dirName?.startsWith(".") || dirName === "node_modules") {
      return
    }

    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const entryPath = join(dirPath, entry.name)

      // skip node_modules and hidden directories
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue
      }

      const packageJsonPath = join(entryPath, "package.json")

      // check if this directory has a package.json
      if (existsSync(packageJsonPath)) {
        try {
          const content = await readFile(packageJsonPath, "utf-8")
          const packageJson = packageJsonSchema.parse(JSON.parse(content))

          const relativePath = relative(workspaceRoot, entryPath)
          const type = packageJson.highstate?.type ?? "source"

          packages.push({
            path: entryPath,
            relativePath,
            name: packageJson.name,
            type,
          })
        } catch {
          // ignore directories with invalid package.json files
        }
      }

      // continue scanning subdirectories, but with limited depth to avoid deep node_modules
      if (depth < 3) {
        await scanDirectory(entryPath, depth + 1)
      }
    }
  }

  await scanDirectory(packagesDir)
  return packages.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

/**
 * Updates the root tsconfig.json with package references
 */
export async function updateTsconfigReferences(
  workspaceRoot: string,
  packages: HighstatePackage[],
  ensureTsconfigs = false,
): Promise<void> {
  const tsconfigPath = join(workspaceRoot, "tsconfig.json")

  // ensure all packages have valid tsconfig.json files
  if (ensureTsconfigs) {
    await ensurePackageTsconfigs(
      workspaceRoot,

      // only udate for Highstate-managed packages
      packages.filter(pkg => pkg.type !== undefined),
    )
  }

  // generate references array
  const references = packages.map(pkg => ({
    path: `./${pkg.relativePath}/tsconfig.json`,
  }))

  const tsconfigContent = {
    files: [],
    references,
  }

  // write the file with proper formatting
  await writeFile(tsconfigPath, `${JSON.stringify(tsconfigContent, null, 2)}\n`, "utf-8")
}

/**
 * Ensures all packages have valid tsconfig.json files
 */
async function ensurePackageTsconfigs(
  workspaceRoot: string,
  packages: HighstatePackage[],
): Promise<void> {
  for (const pkg of packages) {
    const tsconfigPath = join(pkg.path, "tsconfig.json")
    const tsconfigContent = generateTsconfigContent(workspaceRoot, pkg.path)

    await writeFile(tsconfigPath, `${JSON.stringify(tsconfigContent, null, 2)}\n`, "utf-8")
  }
}

/**
 * Creates a new package of the specified type
 */
export async function createPackage(
  workspaceRoot: string,
  name: string,
  type: "source" | "library" | "worker",
): Promise<HighstatePackage> {
  const packagePath = join(workspaceRoot, "packages", name)
  const srcPath = join(packagePath, "src")

  // create directories
  await mkdir(packagePath, { recursive: true })
  await mkdir(srcPath, { recursive: true })

  // create package.json
  const packageJson = {
    name: `@highstate/${name}`,
    version: "0.0.1",
    type: "module",
    highstate: {
      type,
    },
  }

  await writeFile(
    join(packagePath, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf-8",
  )

  // create tsconfig.json
  const tsconfigContent = generateTsconfigContent(workspaceRoot, packagePath)
  await writeFile(
    join(packagePath, "tsconfig.json"),
    `${JSON.stringify(tsconfigContent, null, 2)}\n`,
    "utf-8",
  )

  // create basic index.ts
  await writeFile(join(srcPath, "index.ts"), `// ${name} package\n`, "utf-8")

  return {
    path: packagePath,
    relativePath: `packages/${name}`,
    name: `@highstate/${name}`,
    type,
  }
}

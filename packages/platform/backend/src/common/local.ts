import { basename } from "node:path"
import { findWorkspaceDir, readPackageJSON } from "pkg-types"

export async function resolveMainLocalProject(
  projectPath?: string,
  projectName?: string,
): Promise<[projecPath: string, projectName: string]> {
  if (!projectPath) {
    projectPath = await findWorkspaceDir()
  }

  if (!projectName) {
    const packageJson = await readPackageJSON(projectPath)
    projectName = packageJson.name
  }

  if (!projectName) {
    projectName = basename(projectPath)
  }

  return [projectPath, projectName]
}

import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export async function getPulumiCliVersion(
  cwd: string,
  commandPath = "pulumi",
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(commandPath, ["version"], {
      cwd,
    })

    const raw = stdout.trim()
    if (raw.length === 0) {
      return null
    }

    return raw.startsWith("v") ? raw.slice(1) : raw
  } catch {
    return null
  }
}

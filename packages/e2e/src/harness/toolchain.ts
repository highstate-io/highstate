import { access, mkdir, symlink } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

/**
 * Reuses only the installed executable, never the caller's Pulumi credentials or state.
 */
export async function preparePulumiCli(directory: string): Promise<string> {
  const executable =
    process.env.HIGHSTATE_E2E_PULUMI_PATH ??
    Bun.which("pulumi") ??
    join(homedir(), ".pulumi/bin/pulumi")

  try {
    await access(executable)
  } catch (cause) {
    throw new Error("Install the Pulumi CLI before running E2E, or set HIGHSTATE_E2E_PULUMI_PATH", {
      cause,
    })
  }

  const bin = join(directory, "home/.pulumi/bin")
  await mkdir(bin, { recursive: true })
  await symlink(executable, join(bin, "pulumi"))
  return dirname(executable)
}

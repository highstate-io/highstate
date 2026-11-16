import type { Evidence } from "./evidence"

/**
 * Signals only the isolated process group created by this harness.
 */
export function killProcessGroup(
  child: { pid: number; kill(signal: NodeJS.Signals): void },
  signal: NodeJS.Signals,
): void {
  try {
    if (process.platform === "win32") {
      child.kill(signal)
    } else {
      process.kill(-child.pid, signal)
    }
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
      throw error
    }
  }
}

/**
 * Runs a bounded subprocess and records its output without retrying failed commands.
 */
export async function command(
  args: string[],
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    evidence?: Evidence
    name?: string
  } = {},
): Promise<string> {
  const child = Bun.spawn(args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: options.timeoutMs ?? 600_000,
    killSignal: "SIGKILL",
    detached: process.platform !== "win32",
  })

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited.then(code => {
      killProcessGroup(child, "SIGKILL")
      return code
    }),
  ])

  if (options.evidence) {
    await options.evidence.write(options.name ?? "command.log", `${stdout}\n${stderr}`)
  }

  if (code !== 0) {
    throw new Error(`Command failed (${code}): ${args.join(" ")}\n${stdout}\n${stderr}`)
  }

  return stdout.trim()
}

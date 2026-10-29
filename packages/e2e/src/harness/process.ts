import type { Evidence } from "./evidence"

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
  })

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  if (options.evidence) {
    await options.evidence.write(options.name ?? "command.log", `${stdout}\n${stderr}`)
  }

  if (code !== 0) {
    throw new Error(`Command failed (${code}): ${args.join(" ")}\n${stdout}\n${stderr}`)
  }

  return stdout.trim()
}

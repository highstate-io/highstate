import { join } from "node:path"
import { root } from "./designer"
import { waitFor } from "./wait"

/**
 * A piped CLI session for scripted prompts and agent interaction, without shell evaluation.
 */
export function startCli(
  environment: { directory: string },
  args: string[],
  options: { timeoutMs?: number } = {},
) {
  let stdout = ""
  let stderr = ""

  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(HIGHSTATE_|NUXT_|NITRO_|DATABASE_URL$)/.test(key),
    ),
  )

  const child = Bun.spawn(
    [process.execPath, join(root, "packages/platform/cli/dist/main.js"), ...args],
    {
      cwd: environment.directory,
      env: {
        ...env,
        HOME: join(environment.directory, "home"),
        XDG_CONFIG_HOME: join(environment.directory, "home/.config"),
        XDG_CACHE_HOME: join(environment.directory, "home/.cache"),
        HIGHSTATE_CODEBASE_PATH: environment.directory,
        HIGHSTATE_ENCRYPTION_ENABLED: "false",
        HIGHSTATE_BACKEND_DATABASE_LOCAL_PATH: join(environment.directory, ".highstate"),
        HIGHSTATE_DESIGNER_WORKER_SOCKET_PATH: join(environment.directory, "worker.sock"),
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeoutMs ?? 60_000,
    },
  )

  const consume = async (stream: ReadableStream<Uint8Array>, append: (text: string) => void) => {
    const decoder = new TextDecoder()

    for await (const chunk of stream) {
      append(decoder.decode(chunk, { stream: true }))
    }

    append(decoder.decode())
  }

  const streams = Promise.all([
    consume(child.stdout, text => {
      stdout += text
    }),
    consume(child.stderr, text => {
      stderr += text
    }),
  ])

  const result = (async () => {
    const exitCode = await child.exited
    await streams
    return { exitCode, stdout, stderr }
  })()

  return {
    result,
    output: () => ({ stdout, stderr }),
    async write(input: string) {
      child.stdin.write(input)
      await child.stdin.flush()
    },
    async end() {
      await child.stdin.end()
    },
    async waitForOutput(text: string, timeoutMs = 10_000) {
      await waitFor(
        `CLI output ${text}`,
        async () => {
          const output = stdout + stderr
          if (!output.includes(text) && child.exitCode !== null) {
            throw new Error(`CLI exited before expected output (${child.exitCode}): ${output}`)
          }

          return output
        },
        output => output.includes(text),
        timeoutMs,
      )
    },
    async stop() {
      if (child.exitCode === null) {
        child.kill("SIGTERM")
      }

      return await result
    },
  }
}

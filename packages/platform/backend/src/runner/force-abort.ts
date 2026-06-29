/** biome-ignore-all lint/suspicious/noExplicitAny: аничо */
/** biome-ignore-all lint/complexity/useLiteralKeys: не ори на мать */

import type { PulumiCommand } from "@pulumi/pulumi/automation/index.js"
import * as os from "node:os"
import { homedir } from "node:os"
import path, { resolve } from "node:path"

/**
 * The extended AbortSignal interface that includes an additional signal
 * to forcefully abort the command.
 */
export interface DualAbortSignal extends AbortSignal {
  forceSignal?: AbortSignal
}

export type ForceAbortableCommandOptions = {
  hostsFilePath?: string
}

export async function createForceAbortableCommand(
  options: ForceAbortableCommandOptions = {},
): Promise<PulumiCommand> {
  // @ts-expect-error some symbols are internal, but we still can import them
  const { PulumiCommand, CommandResult, createCommandError } = await import(
    "@pulumi/pulumi/automation/index.js"
  )

  const commandOptions = {
    root: resolve(homedir(), ".pulumi"),
  }

  const command: any = await PulumiCommand.get(commandOptions)

  // replicate the run method from PulumiCommand
  command.run = function (
    this: PulumiCommand,
    args: string[],
    cwd: string,
    additionalEnv: { [key: string]: string },
    onOutput?: (data: string) => void,
    onError?: (data: string) => void,
    signal?: DualAbortSignal,
  ): Promise<unknown> {
    // all commands should be run in non-interactive mode.
    // this causes commands to fail rather than prompting for input (and thus hanging indefinitely)
    if (!args.includes("--non-interactive")) {
      args.push("--non-interactive")
    }

    // Prepend the folder where the CLI is installed to the path to ensure
    // we pickup the matching bundled plugins.
    if (path.isAbsolute(this.command)) {
      const pulumiBin = path.dirname(this.command)
      const sep = os.platform() === "win32" ? ";" : ":"
      const envPath = pulumiBin + sep + (additionalEnv["PATH"] || process.env.PATH)
      additionalEnv["PATH"] = envPath
    }

    return exec(this.command, args, cwd, additionalEnv, onOutput, onError, signal)
  }

  async function exec(
    command: string,
    args: string[],
    cwd?: string,
    additionalEnv?: { [key: string]: string },
    onOutput?: (data: string) => void,
    onError?: (data: string) => void,
    signal?: DualAbortSignal,
  ): Promise<unknown> {
    const unknownErrCode = -2

    const env = additionalEnv ? { ...additionalEnv } : undefined

    try {
      const commandLine = options.hostsFilePath
        ? [
            "unshare",
            "--user",
            "--map-current-user",
            "--keep-caps",
            "--mount",
            "--propagation",
            "private",
            "--forward-signals",
            "--kill-child=SIGKILL",
            "--",
            "sh",
            "-c",
            'mount --bind "$HIGHSTATE_HOSTS_FILE" /etc/hosts && exec "$@"',
            "sh",
            command,
            ...args,
          ]
        : [command, ...args]

      const proc = Bun.spawn(commandLine, {
        cwd,
        env: options.hostsFilePath
          ? {
              ...env,
              HIGHSTATE_HOSTS_FILE: options.hostsFilePath,
            }
          : env,
        stdout: "pipe",
        stderr: "pipe",
      })

      const readStream = async (
        stream: ReadableStream<Uint8Array> | null,
        onData?: (data: string) => void,
      ): Promise<string> => {
        if (!stream) {
          return ""
        }

        const reader = stream.getReader()
        const decoder = new TextDecoder()
        let output = ""

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              break
            }

            const chunk = decoder.decode(value, { stream: true })
            if (chunk.length > 0) {
              output += chunk
              onData?.(chunk)
            }
          }

          const tail = decoder.decode()
          if (tail.length > 0) {
            output += tail
            onData?.(tail)
          }
        } finally {
          reader.releaseLock()
        }

        return output
      }

      if (signal) {
        const abortHandler = () => {
          proc.kill("SIGINT")
        }

        signal.addEventListener("abort", () => {
          abortHandler()
        })

        if (signal.aborted) {
          abortHandler()
        }

        // custom logic to handle force kill
        if (signal.forceSignal) {
          const forceAbortHandler = () => {
            proc.kill("SIGKILL")
          }

          signal.forceSignal.addEventListener("abort", () => {
            forceAbortHandler()
          })

          if (signal.forceSignal.aborted) {
            forceAbortHandler()
          }
        }
      }

      const [stdout, stderr, exitCode] = await Promise.all([
        readStream(proc.stdout, onOutput),
        readStream(proc.stderr, onError),
        proc.exited,
      ])

      const commandResult = new CommandResult(stdout, stderr, exitCode)
      if (exitCode !== 0) {
        throw createCommandError(commandResult)
      }

      return commandResult
    } catch (err) {
      const error = err as Error
      throw createCommandError(new CommandResult("", error.message, unknownErrCode, error))
    }
  }

  return command as PulumiCommand
}

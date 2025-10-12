/** biome-ignore-all lint/suspicious/noExplicitAny: аничо */
/** biome-ignore-all lint/complexity/useLiteralKeys: не ори на мать */

import type { PulumiCommand } from "@pulumi/pulumi/automation/index.js"
import * as os from "node:os"
import path from "node:path"
import { execa } from "execa"

/**
 * The extended AbortSignal interface that includes an additional signal
 * to forcefully abort the command.
 */
export interface DualAbortSignal extends AbortSignal {
  forceSignal?: AbortSignal
}

export async function createForceAbortableCommand(): Promise<PulumiCommand> {
  // @ts-expect-error some symbols are internal, but we still can import them
  const { PulumiCommand, CommandResult, createCommandError } = await import(
    "@pulumi/pulumi/automation/index.js"
  )

  const command: any = await PulumiCommand.get()

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
      const proc = execa(command, args, { env, cwd })

      if (onError && proc.stderr) {
        proc.stderr.on("data", (data: any) => {
          if (data?.toString) {
            data = data.toString()
          }
          onError(data)
        })
      }

      if (onOutput && proc.stdout) {
        proc.stdout.on("data", (data: any) => {
          if (data?.toString) {
            data = data.toString()
          }
          onOutput(data)
        })
      }

      if (signal) {
        signal.addEventListener("abort", () => {
          proc.kill("SIGINT")
        })

        // custom logic to handle force kill
        if (signal.forceSignal) {
          signal.forceSignal.addEventListener("abort", () => {
            proc.kill("SIGKILL")
          })
        }
      }

      const { stdout, stderr, exitCode } = await proc
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

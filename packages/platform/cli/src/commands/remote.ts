import { Command, Option } from "clipanion"
import {
  createHighstateClients,
  formatRemoteError,
  type HighstateClients,
  type OutputFormat,
  type RemoteTarget,
  resolveRemoteTarget,
  writeOutput,
} from "../shared"

export abstract class RemoteCommand extends Command {
  contextName = Option.String("--context")
  apiUrl = Option.String("--api-url")
  projectId = Option.String("--project")
  output = Option.String("--output", "human")

  async remote(requireProject = true): Promise<{
    clients: HighstateClients
    target: RemoteTarget & { projectId: string }
  }> {
    const target = await resolveRemoteTarget(
      { context: this.contextName, apiUrl: this.apiUrl, projectId: this.projectId },
      { requireProject },
    )

    return {
      clients: createHighstateClients(target.apiUrl, target.apiToken),
      target: target as RemoteTarget & { projectId: string },
    }
  }

  protected format(): OutputFormat {
    if (this.output !== "human" && this.output !== "json" && this.output !== "yaml") {
      throw new Error(`Unsupported output format "${this.output}"`)
    }

    return this.output
  }

  print(value: unknown, human?: string): void {
    writeOutput(value, this.format(), human)
  }

  async catch(error: unknown): Promise<void> {
    const formatted = formatRemoteError(error)

    if (this.output === "json") {
      process.stderr.write(`${JSON.stringify(formatted)}\n`)
    } else {
      process.stderr.write(`${String(formatted.error.message)}\n`)
    }

    process.exitCode = 1
  }
}

import { Command, Option } from "clipanion"
import { agentDocuments, readAgentDocuments } from "../shared"

export class AgentDocsGetCommand extends Command {
  static paths = [["agent", "docs", "get"]]

  static usage = Command.Usage({
    category: "Agent",
    description: "Prints one or more version-aligned agent reference documents.",
  })

  documentIds = Option.Rest({ required: 1 })

  async execute(): Promise<void> {
    process.stdout.write(`${await readAgentDocuments(this.documentIds)}\n`)
  }
}

export class AgentInstructionsCommand extends Command {
  static paths = [["agent", "instructions"]]

  static usage = Command.Usage({
    category: "Agent",
    description:
      "Prints static, version-aligned instructions for an agent without checking access.",
  })

  async execute(): Promise<void> {
    process.stdout.write(formatAgentInstructions())
  }
}

export function formatAgentInstructions(): string {
  return [
    "# Highstate Agent Instructions",
    "",
    "Use `highstate status` when access is unknown or there is reason to believe it has changed, such as a context or project switch, a credential change, or an access failure.",
    "Reuse known status; do not refresh it before every command or task without a reason.",
    "When no project is selected, ask the user which project to use. Pass `--project <project-id>` to `highstate status` and every project-scoped command rather than changing the user's configuration with `highstate project use`.",
    "",
    "## Agent References",
    "",
    ...agentDocuments.map(document => `- \`${document.id}\`: ${document.description}`),
    "",
    "Fetch every relevant reference in one call:",
    "",
    "```bash",
    "highstate agent docs get <document-id> [document-id...]",
    "```",
    "",
  ].join("\n")
}

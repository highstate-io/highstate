import { Code, ConnectError } from "@connectrpc/connect"
import { ErrorInfoSchema } from "@highstate/api/v1"
import { Command, Option } from "clipanion"
import { agentDocuments, readAgentDocuments, readCurrentPackageVersion } from "../shared"
import {
  createHighstateClients,
  getContextToken,
  type HighstateClients,
  normalizeApiUrl,
  readRemoteConfig,
} from "../shared/remote"

type CheckState = "ready" | "missing" | "unavailable" | "denied" | "locked" | "unverified"

export type AgentStatus = {
  cli_version: string
  context?: string
  api_url?: string
  project_id?: string
  backend: { state: CheckState; detail: string }
  project: { state: CheckState; detail: string }
  next_actions: string[]
}

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

export class AgentStatusCommand extends Command {
  static paths = [["agent", "status"]]

  static usage = Command.Usage({
    category: "Agent",
    description: "Reports CLI, backend authorization, and project access status for an agent.",
  })

  contextName = Option.String("--context")
  apiUrl = Option.String("--api-url")
  projectId = Option.String("--project")

  async execute(): Promise<void> {
    const status = await collectAgentStatus({
      contextName: this.contextName,
      apiUrl: this.apiUrl,
      projectId: this.projectId,
      moduleUrl: import.meta.url,
    })

    process.stdout.write(formatAgentStatus(status))
  }
}

export class AgentInstructionsCommand extends Command {
  static paths = [["agent", "instructions"]]

  static usage = Command.Usage({
    category: "Agent",
    description: "Prints current access status and version-aligned instructions for an agent.",
  })

  contextName = Option.String("--context")
  apiUrl = Option.String("--api-url")
  projectId = Option.String("--project")

  async execute(): Promise<void> {
    const status = await collectAgentStatus({
      contextName: this.contextName,
      apiUrl: this.apiUrl,
      projectId: this.projectId,
      moduleUrl: import.meta.url,
    })

    process.stdout.write(formatAgentInstructions(status))
  }
}

export async function collectAgentStatus(options: {
  contextName?: string
  apiUrl?: string
  projectId?: string
  moduleUrl: string
  env?: NodeJS.ProcessEnv
  clients?: HighstateClients
}): Promise<AgentStatus> {
  const env = options.env ?? process.env
  const version = await readCurrentPackageVersion(options.moduleUrl)
  const config = await readRemoteConfig(env)
  const contextName = options.contextName ?? env.HIGHSTATE_CONTEXT ?? config.activeContext
  const context = contextName ? config.contexts[contextName] : undefined
  const apiUrlValue = options.apiUrl ?? env.HIGHSTATE_API_URL ?? context?.apiUrl
  const projectId = options.projectId ?? env.HIGHSTATE_PROJECT_ID ?? context?.projectId
  const status: AgentStatus = {
    cli_version: version,
    context: contextName,
    api_url: apiUrlValue,
    project_id: projectId,
    backend: { state: "missing", detail: "No active Highstate backend is configured." },
    project: { state: "missing", detail: "No Highstate project is selected." },
    next_actions: [],
  }

  if (contextName && !context) {
    status.backend.detail = `Context "${contextName}" does not exist.`
    status.next_actions.push("Ask the user to select or configure a valid Highstate context.")
    return status
  }

  if (!apiUrlValue) {
    status.next_actions.push(
      "Ask the user to configure a Highstate context or provide HIGHSTATE_API_URL.",
    )
    return status
  }

  let apiUrl: string
  try {
    apiUrl = normalizeApiUrl(apiUrlValue)
    status.api_url = apiUrl
  } catch (error) {
    status.backend.detail = error instanceof Error ? error.message : "The backend URL is invalid."
    status.next_actions.push("Ask the user to correct the Highstate backend URL.")
    return status
  }

  let apiToken: string | undefined
  try {
    apiToken =
      env.HIGHSTATE_API_TOKEN ??
      (contextName ? await getContextToken(contextName, context) : undefined)
  } catch (error) {
    status.backend.detail = error instanceof Error ? error.message : "The API token is unavailable."
    status.next_actions.push("Ask the user to make the configured Highstate API token available.")
    return status
  }

  if (!apiToken) {
    status.backend.detail = "No API token is available for the active Highstate backend."
    status.next_actions.push("Ask the user to provide or configure a Highstate API token.")
    return status
  }

  const clients = options.clients ?? createHighstateClients(apiUrl, apiToken)
  let selectedProjectLocked: boolean | undefined

  try {
    const response = await clients.project.listProjects({ pageSize: 100 })
    status.backend = {
      state: "ready",
      detail: "The backend is reachable and the API token can list visible projects.",
    }
    if (projectId) {
      selectedProjectLocked = response.projects.find(
        entry => entry.project?.id === projectId,
      )?.isLocked
    }
  } catch (error) {
    const failure = classifyRemoteFailure(error)
    status.backend = failure
    if (failure.state === "unavailable") {
      status.next_actions.push("Ask the user to start or expose the configured Highstate backend.")
      return status
    }
  }

  if (!projectId) {
    status.next_actions.push(
      "Ask the user which project to use, then select it with highstate project use <project-id>.",
    )
    return status
  }

  if (selectedProjectLocked) {
    status.project = {
      state: "locked",
      detail: `Project "${projectId}" is locked; project authorization cannot be verified until it is unlocked.`,
    }
    status.next_actions.push(`Ask the user to unlock project "${projectId}" in Highstate.`)
    return status
  }

  try {
    const response = await clients.project.getProject({ projectId })
    status.project = {
      state: "ready",
      detail: `Project "${response.project?.id ?? projectId}" is unlocked and authorized.`,
    }
  } catch (error) {
    const reason = remoteReason(error)
    if (reason === "PROJECT_LOCKED") {
      status.project = {
        state: "locked",
        detail: `Project "${projectId}" is locked; project authorization cannot be verified until it is unlocked.`,
      }
      status.next_actions.push(`Ask the user to unlock project "${projectId}" in Highstate.`)
      return status
    }

    const failure = classifyRemoteFailure(error)
    status.project = failure
    if (failure.state === "denied") {
      status.next_actions.push(
        `Ask the user to authorize the configured API key for project "${projectId}" with the permissions required by the task.`,
      )
    } else if (failure.state === "missing") {
      status.next_actions.push(
        `Ask the user to verify that project "${projectId}" exists and is visible.`,
      )
    }
  }

  return status
}

function classifyRemoteFailure(error: unknown): AgentStatus["backend"] {
  if (!(error instanceof ConnectError)) {
    return {
      state: "unavailable",
      detail: error instanceof Error ? error.message : "The Highstate backend is unavailable.",
    }
  }

  if (error.code === Code.Unauthenticated || error.code === Code.PermissionDenied) {
    return { state: "denied", detail: error.rawMessage }
  }

  if (error.code === Code.NotFound) {
    return { state: "missing", detail: error.rawMessage }
  }

  if (error.code === Code.Unavailable || error.code === Code.DeadlineExceeded) {
    return { state: "unavailable", detail: error.rawMessage }
  }

  return { state: "unverified", detail: error.rawMessage }
}

function remoteReason(error: unknown): string | undefined {
  if (!(error instanceof ConnectError)) {
    return undefined
  }

  return error.findDetails(ErrorInfoSchema)[0]?.reason
}

export function formatAgentStatus(status: AgentStatus): string {
  const lines = [
    "# Highstate Agent Status",
    "",
    `- CLI version: ${status.cli_version}`,
    `- Context: ${status.context ?? "not selected"}`,
    `- Backend URL: ${status.api_url ?? "not configured"}`,
    `- Backend access: ${status.backend.state} - ${status.backend.detail}`,
    `- Project: ${status.project_id ?? "not selected"}`,
    `- Project access: ${status.project.state} - ${status.project.detail}`,
    "",
  ]

  return `${lines.join("\n")}\n`
}

export function formatAgentInstructions(status: AgentStatus): string {
  const lines = [
    formatAgentStatus(status).trimEnd(),
    "",
    "## Next Actions",
    "",
    ...(status.next_actions.length > 0
      ? status.next_actions.map(action => `- ${action}`)
      : ["- Access is ready. Continue with the user's requested Highstate task."]),
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
    "Run `highstate agent instructions` again whenever current access status or next steps may have changed.",
    "",
  ]

  return `${lines.join("\n")}\n`
}

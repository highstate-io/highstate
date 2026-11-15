import { Code, ConnectError } from "@connectrpc/connect"
import { ErrorInfoSchema } from "@highstate/api/v1"
import { Command } from "clipanion"
import { readCurrentPackageVersion } from "../shared"
import {
  createHighstateClients,
  getContextToken,
  type HighstateClients,
  humanDetails,
  normalizeApiUrl,
  readRemoteConfig,
} from "../shared/remote"
import { RemoteCommand } from "./remote"

type CheckState = "ready" | "missing" | "unavailable" | "denied" | "locked" | "unverified"

export type Status = {
  cli_version: string
  context?: string
  api_url?: string
  project_id?: string
  backend: { state: CheckState; detail: string }
  project: { state: CheckState; detail: string }
  next_actions: string[]
}

export class StatusCommand extends RemoteCommand {
  static paths = [["status"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Reports CLI, backend authorization, and project access status.",
  })

  async execute(): Promise<void> {
    const status = await collectStatus({
      contextName: this.contextName,
      apiUrl: this.apiUrl,
      projectId: this.projectId,
      moduleUrl: import.meta.url,
    })

    this.print(status, formatStatus(status))
  }
}

export function formatStatus(status: Status): string {
  const { next_actions, ...details } = status
  return humanDetails(next_actions.length > 0 ? status : details)
}

export async function collectStatus(options: {
  contextName?: string
  apiUrl?: string
  projectId?: string
  moduleUrl: string
  env?: NodeJS.ProcessEnv
  clients?: HighstateClients
}): Promise<Status> {
  const env = options.env ?? process.env
  const version = await readCurrentPackageVersion(options.moduleUrl)
  const config = await readRemoteConfig(env)
  const contextName = options.contextName ?? env.HIGHSTATE_CONTEXT ?? config.activeContext
  const context = contextName ? config.contexts[contextName] : undefined
  const apiUrlValue = options.apiUrl ?? env.HIGHSTATE_API_URL ?? context?.apiUrl
  const projectId = options.projectId ?? env.HIGHSTATE_PROJECT_ID ?? context?.projectId

  const status: Status = {
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
    status.next_actions.push("Select or configure a valid Highstate context.")
    return status
  }

  if (!apiUrlValue) {
    status.next_actions.push("Configure a Highstate context or provide HIGHSTATE_API_URL.")

    return status
  }

  let apiUrl: string

  try {
    apiUrl = normalizeApiUrl(apiUrlValue)
    status.api_url = apiUrl
  } catch (error) {
    status.backend.detail = error instanceof Error ? error.message : "The backend URL is invalid."
    status.next_actions.push("Correct the Highstate backend URL.")
    return status
  }

  let apiToken: string | undefined

  try {
    apiToken =
      env.HIGHSTATE_API_TOKEN ??
      (contextName ? await getContextToken(contextName, context) : undefined)
  } catch (error) {
    status.backend.detail = error instanceof Error ? error.message : "The API token is unavailable."
    status.next_actions.push("Make the configured Highstate API token available.")
    return status
  }

  if (!apiToken) {
    status.backend.detail = "No API token is available for the active Highstate backend."
    status.next_actions.push("Provide or configure a Highstate API token.")
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
      status.next_actions.push("Start or expose the configured Highstate backend.")
      return status
    }
  }

  if (!projectId) {
    status.next_actions.push(
      "Select a project with highstate project use <project-id> or pass --project <project-id>.",
    )

    return status
  }

  if (selectedProjectLocked) {
    status.project = {
      state: "locked",
      detail: `Project "${projectId}" is locked; project authorization cannot be verified until it is unlocked.`,
    }

    status.next_actions.push(`Unlock project "${projectId}" in Highstate.`)
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

      status.next_actions.push(`Unlock project "${projectId}" in Highstate.`)
      return status
    }

    const failure = classifyRemoteFailure(error)
    status.project = failure

    if (failure.state === "denied") {
      status.next_actions.push(
        `Authorize the configured API key for project "${projectId}" with the required permissions.`,
      )
    } else if (failure.state === "missing") {
      status.next_actions.push(`Verify that project "${projectId}" exists and is visible.`)
    }
  }

  return status
}

function classifyRemoteFailure(error: unknown): Status["backend"] {
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

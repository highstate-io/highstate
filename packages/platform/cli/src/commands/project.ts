import { GetProjectResponseSchema, ListProjectsResponseSchema } from "@highstate/api/v1"
import { Command, Option } from "clipanion"
import { messageJson, readRemoteConfig, writeRemoteConfig } from "../shared/remote"
import { RemoteCommand } from "./remote"

export class ProjectListCommand extends RemoteCommand {
  static paths = [["project", "list"]]

  static usage = Command.Usage({ category: "Backend API", description: "Lists visible projects." })

  pageSize = Option.String("--page-size")
  pageToken = Option.String("--page-token")
  all = Option.Boolean("--all", false)

  async execute(): Promise<void> {
    const { clients } = await this.remote(false)
    const pageSize = parsePageSize(this.pageSize)
    const projects = []
    let pageToken = this.pageToken ?? ""

    do {
      const response = await clients.project.listProjects({
        pageSize,
        pageToken,
      })

      projects.push(...response.projects)
      pageToken = response.nextPageToken ?? ""

      if (!this.all) {
        this.print(
          messageJson(ListProjectsResponseSchema, response),
          response.projects
            .map(
              entry =>
                `${entry.project?.id}\t${entry.project?.meta?.title ?? entry.project?.name}\t${entry.isLocked ? "locked" : "unlocked"}`,
            )
            .join("\n") || "No projects",
        )
        return
      }
    } while (pageToken)

    this.print(
      {
        projects: projects.map(entry =>
          messageJson(ListProjectsResponseSchema.field.projects.message!, entry),
        ),
      },
      projects
        .map(
          entry =>
            `${entry.project?.id}\t${entry.project?.meta?.title ?? entry.project?.name}\t${entry.isLocked ? "locked" : "unlocked"}`,
        )
        .join("\n") || "No projects",
    )
  }
}

export function parsePageSize(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const pageSize = Number(value)
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error("Page size must be an integer between 1 and 100")
  }

  return pageSize
}

export class ProjectGetCommand extends RemoteCommand {
  static paths = [["project", "get"]]

  static usage = Command.Usage({ category: "Backend API", description: "Gets project metadata." })

  id = Option.String({ required: false })

  async execute(): Promise<void> {
    if (this.id) {
      this.projectId = this.id
    }

    const { clients, target } = await this.remote()
    const response = await clients.project.getProject({ projectId: target.projectId })

    this.print(
      messageJson(GetProjectResponseSchema, response),
      `${response.project?.meta?.title ?? response.project?.name} (${response.project?.id})\n${response.isLocked ? "Locked" : "Unlocked"}`,
    )
  }
}

export class ProjectUseCommand extends RemoteCommand {
  static paths = [["project", "use"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Selects a project for the active context.",
  })

  id = Option.String({ required: true })

  async execute(): Promise<void> {
    const config = await readRemoteConfig()
    const name = this.contextName ?? process.env.HIGHSTATE_CONTEXT ?? config.activeContext

    if (!name || !config.contexts[name]) {
      throw new Error("An active named context is required")
    }

    this.contextName = name
    this.projectId = this.id

    const { clients } = await this.remote()

    await clients.project.getProject({ projectId: this.id })

    config.contexts[name].projectId = this.id

    await writeRemoteConfig(config)

    this.print(
      { context: name, project_id: this.id },
      `Using project "${this.id}" in context "${name}"`,
    )
  }
}

export class ProjectUnsetCommand extends RemoteCommand {
  static paths = [["project", "unset"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Clears the selected project.",
  })

  async execute(): Promise<void> {
    const config = await readRemoteConfig()
    const name = this.contextName ?? config.activeContext

    if (!name || !config.contexts[name]) {
      throw new Error("An active named context is required")
    }

    config.contexts[name].projectId = undefined

    await writeRemoteConfig(config)

    this.print({ context: name }, `Cleared selected project in context "${name}"`)
  }
}

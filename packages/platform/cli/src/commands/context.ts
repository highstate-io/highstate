import { password } from "@inquirer/prompts"
import { Command, Option } from "clipanion"
import {
  createHighstateClients,
  deleteContextToken,
  getContextToken,
  readRemoteConfig,
  setContextToken,
  validateContextName,
  writeOutput,
  writeRemoteConfig,
} from "../shared/remote"

abstract class ContextCommand extends Command {
  output = Option.String("--output", "human")

  protected print(value: unknown, human: string): void {
    const format = this.output === "json" || this.output === "yaml" ? this.output : "human"
    writeOutput(value, format, human)
  }
}

export class ContextAddCommand extends ContextCommand {
  static paths = [["context", "add"]]

  static usage = Command.Usage({ category: "Backend API", description: "Adds a backend context." })

  name = Option.String({ required: true })
  apiUrl = Option.String("--api-url", { required: true })
  projectId = Option.String("--project")
  tokenStdin = Option.Boolean("--api-token-stdin", false)
  force = Option.Boolean("--force", false)

  async execute(): Promise<void> {
    const name = validateContextName(this.name)
    const config = await readRemoteConfig()
    if (config.contexts[name] && !this.force) {
      throw new Error(`Highstate context "${name}" already exists; use --force to replace it`)
    }

    let token = process.env.HIGHSTATE_API_TOKEN
    if (this.tokenStdin) {
      token = (await Bun.stdin.text()).trim()
    } else if (!token && process.stdin.isTTY) {
      token = await password({ message: "API token" })
    }
    if (!token) {
      throw new Error("Provide an API token through --api-token-stdin or HIGHSTATE_API_TOKEN")
    }

    await setContextToken(name, token)
    config.contexts[name] = { apiUrl: this.apiUrl, projectId: this.projectId }
    config.activeContext ??= name
    await writeRemoteConfig(config)

    this.print(
      { name, ...config.contexts[name], active: config.activeContext === name },
      `Added context "${name}"`,
    )
  }
}

export class ContextListCommand extends ContextCommand {
  static paths = [["context", "list"]]

  static usage = Command.Usage({ category: "Backend API", description: "Lists backend contexts." })

  async execute(): Promise<void> {
    const config = await readRemoteConfig()
    const contexts = await Promise.all(
      Object.entries(config.contexts).map(async ([name, value]) => ({
        name,
        api_url: value.apiUrl,
        project_id: value.projectId,
        active: name === config.activeContext,
        has_token: Boolean(await getContextToken(name)),
      })),
    )

    this.print(
      { contexts },
      contexts.length
        ? contexts
            .map(
              value =>
                `${value.active ? "*" : " "} ${value.name}\t${value.api_url}\t${value.project_id ?? "-"}`,
            )
            .join("\n")
        : "No contexts configured",
    )
  }
}

export class ContextShowCommand extends ContextCommand {
  static paths = [["context", "show"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Shows one backend context.",
  })

  name = Option.String({ required: false })

  async execute(): Promise<void> {
    const config = await readRemoteConfig()
    const name = this.name ?? config.activeContext
    if (!name || !config.contexts[name]) {
      throw new Error("Highstate context not found")
    }

    const context = config.contexts[name]
    const value = {
      name,
      api_url: context.apiUrl,
      project_id: context.projectId,
      active: name === config.activeContext,
      has_token: Boolean(await getContextToken(name)),
    }

    this.print(
      value,
      `${value.active ? "Active " : ""}context "${name}"\nAPI URL: ${value.api_url}\nProject: ${value.project_id ?? "not selected"}\nToken: ${value.has_token ? "stored" : "missing"}`,
    )
  }
}

export class ContextUseCommand extends ContextCommand {
  static paths = [["context", "use"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Selects the active backend context.",
  })

  name = Option.String({ required: true })

  async execute(): Promise<void> {
    const config = await readRemoteConfig()
    if (!config.contexts[this.name]) {
      throw new Error(`Highstate context "${this.name}" not found`)
    }

    config.activeContext = this.name
    await writeRemoteConfig(config)

    this.print({ active_context: this.name }, `Using context "${this.name}"`)
  }
}

export class ContextDeleteCommand extends ContextCommand {
  static paths = [["context", "delete"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Deletes a backend context.",
  })

  name = Option.String({ required: true })
  yes = Option.Boolean("--yes", false)

  async execute(): Promise<void> {
    if (!this.yes) {
      throw new Error("Context deletion requires --yes")
    }

    const config = await readRemoteConfig()
    if (!config.contexts[this.name]) {
      throw new Error(`Highstate context "${this.name}" not found`)
    }

    delete config.contexts[this.name]
    if (config.activeContext === this.name) {
      config.activeContext = undefined
    }

    await deleteContextToken(this.name)
    await writeRemoteConfig(config)

    this.print({}, `Deleted context "${this.name}"`)
  }
}

export class ContextTestCommand extends ContextCommand {
  static paths = [["context", "test"]]

  static usage = Command.Usage({ category: "Backend API", description: "Tests a backend context." })

  name = Option.String({ required: false })

  async execute(): Promise<void> {
    const config = await readRemoteConfig()
    const name = this.name ?? config.activeContext
    if (!name || !config.contexts[name]) {
      throw new Error("Highstate context not found")
    }

    const context = config.contexts[name]
    const token = await getContextToken(name)
    if (!token) {
      throw new Error(`No API token stored for context "${name}"`)
    }

    const clients = createHighstateClients(context.apiUrl, token)
    if (context.projectId) {
      await clients.project.getProject({ projectId: context.projectId })
      this.print(
        { context: name, reachable: true, project_id: context.projectId },
        `Context "${name}" can access project "${context.projectId}"`,
      )
      return
    }

    const response = await clients.project.listProjects({ pageSize: 1 })

    this.print(
      { context: name, reachable: true, projects_visible: response.projects.length },
      `Context "${name}" is reachable`,
    )
  }
}

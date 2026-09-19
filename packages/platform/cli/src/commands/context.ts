import { confirm, input, password } from "@inquirer/prompts"
import { Command, Option } from "clipanion"
import {
  assertKeyringAvailable,
  createHighstateClients,
  deleteContextToken,
  getContextToken,
  KeyringUnavailableError,
  normalizeApiUrl,
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

  async catch(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : "Context command failed"

    if (this.output === "json") {
      process.stderr.write(`${JSON.stringify({ error: { message } })}\n`)
    } else {
      process.stderr.write(`${message}\n`)
    }

    process.exitCode = 1
  }
}

export class ContextAddCommand extends ContextCommand {
  static paths = [["context", "add"]]

  static usage = Command.Usage({ category: "Backend API", description: "Adds a backend context." })

  name = Option.String({ required: false })
  apiUrl = Option.String("--api-url")
  projectId = Option.String("--project")
  tokenStdin = Option.Boolean("--api-token-stdin", false)
  insecure = Option.Boolean("--insecure", false)
  force = Option.Boolean("--force", false)

  async execute(): Promise<void> {
    const name = await this.resolveName()
    const apiUrl = await this.resolveApiUrl()
    const config = await readRemoteConfig()
    if (config.contexts[name] && !this.force) {
      throw new Error(`Highstate context "${name}" already exists; use --force to replace it`)
    }

    let storeInConfig = this.insecure
    if (!storeInConfig) {
      try {
        await assertKeyringAvailable()
      } catch (error) {
        if (!(error instanceof KeyringUnavailableError)) {
          throw error
        }

        if (!process.stdin.isTTY) {
          throw error
        }

        process.stderr.write(`${error.message}\n`)
        if (error.details) {
          process.stderr.write(`Keyring details: ${error.details}\n`)
        }

        storeInConfig = await confirm({
          message: "Store the API token in plaintext instead?",
          default: false,
        })

        if (!storeInConfig) {
          process.exitCode = 1
          return
        }
      }
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

    if (!storeInConfig) {
      await setContextToken(name, token)
    }

    config.contexts[name] = {
      apiUrl,
      projectId: this.projectId,
      apiToken: storeInConfig ? token.trim() : undefined,
    }
    config.activeContext ??= name
    await writeRemoteConfig(config)

    this.print(
      {
        name,
        api_url: apiUrl,
        project_id: this.projectId,
        token_storage: storeInConfig ? "plaintext" : "keyring",
        active: config.activeContext === name,
      },
      `Added context "${name}"`,
    )
  }

  private async resolveName(): Promise<string> {
    if (this.name) {
      return validateContextName(this.name)
    }

    if (!process.stdin.isTTY) {
      throw new Error("Provide a context name")
    }

    return await input({
      message: "Context name",
      validate: value => {
        try {
          validateContextName(value)
          return true
        } catch {
          return "Use letters, numbers, dots, underscores, or hyphens"
        }
      },
    })
  }

  private async resolveApiUrl(): Promise<string> {
    if (this.apiUrl) {
      return normalizeApiUrl(this.apiUrl)
    }

    if (!process.stdin.isTTY) {
      throw new Error("Provide a backend URL through --api-url")
    }

    const value = await input({
      message: "Backend URL",
      validate: inputValue => {
        try {
          normalizeApiUrl(inputValue)
          return true
        } catch (error) {
          return error instanceof Error ? error.message : "Enter a valid backend URL"
        }
      },
    })

    return normalizeApiUrl(value)
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
        has_token: Boolean(await getContextToken(name, value)),
        token_storage: value.apiToken ? "plaintext" : "keyring",
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
      has_token: Boolean(await getContextToken(name, context)),
      token_storage: context.apiToken ? "plaintext" : "keyring",
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

    const context = config.contexts[this.name]
    delete config.contexts[this.name]
    if (config.activeContext === this.name) {
      config.activeContext = undefined
    }

    if (!context.apiToken) {
      await deleteContextToken(this.name)
    }

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
    const token = await getContextToken(name, context)
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

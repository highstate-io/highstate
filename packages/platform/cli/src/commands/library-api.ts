import { toJson } from "@bufbuild/protobuf"
import {
  ComponentSchema,
  EntitySchema,
  GetComponentResponseSchema,
  ListComponentsResponseSchema,
} from "@highstate/api/v1"
import { Command, Option } from "clipanion"
import { messageJson } from "../shared/remote"
import { RemoteCommand } from "./remote"

export class LibraryListCommand extends RemoteCommand {
  static paths = [["library", "list"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Lists available component and entity types.",
  })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.library.getLibrary({ projectId: target.projectId })
    const result = {
      components: Object.values(response.library?.components ?? {}).map(value => ({
        type: value.type,
        title: value.meta?.title ?? value.type,
      })),
      entities: Object.values(response.library?.entities ?? {}).map(value => ({
        type: value.type,
        title: value.meta?.title ?? value.type,
      })),
    }

    this.print(
      result,
      [
        ...result.components.map(value => `component\t${value.type}\t${value.title}`),
        ...result.entities.map(value => `entity\t${value.type}\t${value.title}`),
      ].join("\n") || "Library is empty",
    )
  }
}

export class ComponentListCommand extends RemoteCommand {
  static paths = [["component", "list"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Lists component summaries.",
  })

  pageSize = Option.String("--page-size")
  pageToken = Option.String("--page-token")
  all = Option.Boolean("--all", false)

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const components = []
    let pageToken = this.pageToken ?? ""
    do {
      const response = await clients.library.listComponents({
        projectId: target.projectId,
        pageSize: Number(this.pageSize ?? 0),
        pageToken,
      })
      if (!this.all) {
        this.print(
          messageJson(ListComponentsResponseSchema, response),
          response.components
            .map(value => `${value.type}\t${value.meta?.title ?? value.type}`)
            .join("\n") || "No components",
        )
        return
      }

      components.push(...response.components)
      pageToken = response.nextPageToken
    } while (pageToken)

    this.print(
      {
        components: components.map(value =>
          toJson(ListComponentsResponseSchema.field.components.message!, value, {
            useProtoFieldName: true,
          }),
        ),
      },
      components.map(value => `${value.type}\t${value.meta?.title ?? value.type}`).join("\n") ||
        "No components",
    )
  }
}

export class ComponentGetCommand extends RemoteCommand {
  static paths = [["component", "get"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Gets a component definition.",
  })

  type = Option.String({ required: true })
  includeSchemas = Option.Boolean("--include-schemas", false)

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.library.getComponent({
      projectId: target.projectId,
      type: this.type,
    })
    if (this.includeSchemas) {
      this.print(
        messageJson(GetComponentResponseSchema, response),
        `${response.component?.type}\n${response.component?.meta?.description ?? ""}`.trim(),
      )
      return
    }

    const component = response.component
      ? (toJson(ComponentSchema, response.component, { useProtoFieldName: true }) as Record<
          string,
          unknown
        >)
      : undefined
    const args = component?.arguments as Record<string, Record<string, unknown>> | undefined
    if (component && args) {
      component.arguments = Object.fromEntries(
        Object.entries(args).map(([name, value]) => {
          const { schema: _schema, ...rest } = value
          return [name, rest]
        }),
      )
    }

    this.print(
      { component },
      `${response.component?.type}\n${response.component?.meta?.description ?? ""}`.trim(),
    )
  }
}

export class ComponentSchemaCommand extends RemoteCommand {
  static paths = [["component", "schema"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Gets component argument schemas.",
  })

  type = Option.String({ required: true })
  argument = Option.String({ required: false })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.library.getComponent({
      projectId: target.projectId,
      type: this.type,
    })
    const json = response.component
      ? (toJson(ComponentSchema, response.component, { useProtoFieldName: true }) as {
          arguments?: Record<string, { schema?: unknown }>
        })
      : undefined
    const schemas = Object.fromEntries(
      Object.entries(json?.arguments ?? {}).flatMap(([name, value]) =>
        value.schema === undefined ? [] : [[name, value.schema]],
      ),
    )
    if (this.argument && !(this.argument in schemas)) {
      throw new Error(`Argument "${this.argument}" not found on component "${this.type}"`)
    }

    const result = this.argument
      ? { type: this.type, argument: this.argument, schema: schemas[this.argument] }
      : { type: this.type, schemas }

    this.print(result)
  }
}

export class EntityListCommand extends RemoteCommand {
  static paths = [["entity", "list"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Lists entity definitions.",
  })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.library.getLibrary({ projectId: target.projectId })
    const entities = Object.values(response.library?.entities ?? {}).map(value => ({
      type: value.type,
      title: value.meta?.title ?? value.type,
    }))

    this.print(
      { entities },
      entities.map(value => `${value.type}\t${value.title}`).join("\n") || "No entities",
    )
  }
}

export class EntityGetCommand extends RemoteCommand {
  static paths = [["entity", "get"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Gets an entity definition.",
  })

  type = Option.String({ required: true })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.library.getLibrary({ projectId: target.projectId })
    const entity = response.library?.entities[this.type]
    if (!entity) {
      throw new Error(`Entity "${this.type}" not found`)
    }

    this.print(
      { entity: toJson(EntitySchema, entity, { useProtoFieldName: true }) },
      `${entity.type}\n${entity.meta?.description ?? ""}`.trim(),
    )
  }
}

import { toJson } from "@bufbuild/protobuf"
import { ValueSchema } from "@bufbuild/protobuf/wkt"
import {
  ComponentKind,
  GetProjectModelResponseSchema,
  HubSchema,
  type Instance,
  InstanceSchema,
  InstanceStateSchema,
} from "@highstate/api/v1"
import { parseArgumentValue } from "@highstate/contract"
import { Command, Option } from "clipanion"
import {
  humanDetails,
  humanTable,
  messageJson,
  nodesInputSchema,
  readDocument,
  toHub,
  toInstance,
} from "../shared/remote"
import { RemoteCommand } from "./remote"

export class ModelGetCommand extends RemoteCommand {
  static paths = [["model", "get"]]

  static usage = Command.Usage({ category: "Backend API", description: "Gets the project model." })

  includeVirtual = Option.Boolean("--include-virtual", false)
  includeGhost = Option.Boolean("--include-ghost", false)

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.projectModel.getProjectModel({
      projectId: target.projectId,
      includeVirtualInstances: this.includeVirtual,
      includeGhostInstances: this.includeGhost,
    })
    this.print(
      messageJson(GetProjectModelResponseSchema, response),
      humanDetails(messageJson(GetProjectModelResponseSchema, response)),
    )
  }
}

export class ModelCreateCommand extends RemoteCommand {
  static paths = [["model", "create"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Creates instances and hubs atomically.",
  })

  file = Option.String("--file", { required: true })

  async execute(): Promise<void> {
    const input = nodesInputSchema.parse(await readDocument(this.file))
    const { clients, target } = await this.remote()
    await clients.projectModel.createNodes({
      projectId: target.projectId,
      instances: input.instances.map(toInstance),
      hubs: input.hubs.map(toHub),
    })

    this.print({}, `Created ${input.instances.length} instances and ${input.hubs.length} hubs`)
  }
}

function dependencies(instance: {
  inputs: Record<string, { values: { instanceId: string }[] }>
  hubInputs: Record<string, { values: { hubId: string }[] }>
  injectionInputs: { hubId: string }[]
}): string[] {
  return [
    ...new Set([
      ...Object.values(instance.inputs).flatMap(value =>
        value.values.map(reference => reference.instanceId),
      ),
      ...Object.values(instance.hubInputs).flatMap(value =>
        value.values.map(reference => `hub:${reference.hubId}`),
      ),
      ...instance.injectionInputs.map(reference => `hub:${reference.hubId}`),
    ]),
  ]
}

export class InstanceListCommand extends RemoteCommand {
  static paths = [["instance", "list"]]

  static usage = Command.Usage({ category: "Backend API", description: "Lists project instances." })

  includeVirtual = Option.Boolean("--include-virtual", false)
  includeGhost = Option.Boolean("--include-ghost", false)
  withState = Option.Boolean("--with-state", false)

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const [resident, full, states] = await Promise.all([
      clients.projectModel.getProjectModel({ projectId: target.projectId }),
      clients.projectModel.getProjectModel({
        projectId: target.projectId,
        includeVirtualInstances: this.includeVirtual,
        includeGhostInstances: this.includeGhost,
      }),
      this.withState ? allStates(clients, target.projectId) : Promise.resolve([]),
    ])
    const residentIds = new Set(resident.model?.instances.map(value => value.id))
    const statesById = new Map(states.map(value => [value.instanceId, value]))
    const instances = (full.model?.instances ?? []).map(value => ({
      instance_id: value.id,
      kind: value.kind,
      is_ghost: !residentIds.has(value.id),
      dependencies: dependencies(value),
      ...(this.withState
        ? {
            state: statesById.get(value.id)
              ? toJson(InstanceStateSchema, statesById.get(value.id)!, {
                  useProtoFieldName: true,
                })
              : null,
          }
        : {}),
    }))

    this.print(
      { instances },
      humanTable(
        ["NAME", "KIND", "RESIDENCY", "DEPENDENCIES", ...(this.withState ? ["STATUS"] : [])],
        instances.map(value => [
          value.instance_id,
          ComponentKind[value.kind] ?? "Unknown",
          value.is_ghost ? "Ghost" : "Resident",
          value.dependencies,
          ...(this.withState
            ? [
                value.state && typeof value.state === "object" && "status" in value.state
                  ? value.state.status
                  : undefined,
              ]
            : []),
        ]),
        "No instances",
      ),
    )
  }
}

async function allStates(
  clients: Awaited<ReturnType<RemoteCommand["remote"]>>["clients"],
  projectId: string,
) {
  const states = []
  let pageToken = ""
  do {
    const response = await clients.instanceState.listInstanceStates({
      projectId,
      includeEvaluationState: true,
      includeLastOperationState: true,
      includeParentInstanceId: true,
      includeExtra: true,
      includeCustomStatuses: true,
      pageSize: 100,
      pageToken,
    })
    states.push(...response.states)
    pageToken = response.nextPageToken
  } while (pageToken)

  return states
}

export class InstanceGetCommand extends RemoteCommand {
  static paths = [["instance", "get"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Gets an instance model and optional state.",
  })

  id = Option.String({ required: true })
  recursive = Option.Boolean("--recursive", false)
  withState = Option.Boolean("--with-state", false)

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const [response, states] = await Promise.all([
      clients.projectModel.getProjectModel({
        projectId: target.projectId,
        includeVirtualInstances: this.recursive,
        includeGhostInstances: true,
      }),
      this.withState ? allStates(clients, target.projectId) : Promise.resolve([]),
    ])
    const instance = response.model?.instances.find(value => value.id === this.id)
    if (!instance) {
      throw new Error(`Instance "${this.id}" not found`)
    }

    const childrenByParent = new Map<string, Instance[]>()
    if (this.recursive) {
      for (const value of response.model?.instances ?? []) {
        if (!value.parentId) {
          continue
        }

        const children = childrenByParent.get(value.parentId) ?? []

        children.push(value)
        childrenByParent.set(value.parentId, children)
      }
    }

    const statesById = new Map(states.map(value => [value.instanceId, value]))
    const item = (value: typeof instance): Record<string, unknown> => {
      const children = childrenByParent.get(value.id)?.map(item)

      return {
        model: toJson(InstanceSchema, value, { useProtoFieldName: true }),
        ...(this.withState
          ? {
              state: statesById.get(value.id)
                ? toJson(InstanceStateSchema, statesById.get(value.id)!, {
                    useProtoFieldName: true,
                  })
                : null,
            }
          : {}),
        ...(children?.length ? { children } : {}),
      }
    }

    const result = item(instance)

    this.print(result, humanDetails(result))
  }
}

export class InstanceArgumentsGetCommand extends RemoteCommand {
  static paths = [["instance", "args", "get"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Gets an instance's argument values.",
  })

  id = Option.String({ required: true })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.projectModel.getProjectModel({ projectId: target.projectId })
    const instance = response.model?.instances.find(value => value.id === this.id)
    if (!instance) {
      throw new Error(`Instance "${this.id}" not found`)
    }

    const args = Object.fromEntries(
      instance.arguments.map(argument => [
        argument.key,
        parseArgumentValue(argument.value ? toJson(ValueSchema, argument.value) : null),
      ]),
    )

    this.print({ arguments: args }, humanDetails(args))
  }
}

export class HubListCommand extends RemoteCommand {
  static paths = [["hub", "list"]]

  static usage = Command.Usage({ category: "Backend API", description: "Lists project hubs." })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.projectModel.getProjectModel({ projectId: target.projectId })
    const hubs =
      response.model?.hubs.map(value => toJson(HubSchema, value, { useProtoFieldName: true })) ?? []

    this.print(
      { hubs },
      humanTable(
        ["NAME", "INPUTS", "INJECTED HUBS"],
        (response.model?.hubs ?? []).map(value => [
          value.id,
          value.inputs.length,
          value.injectionInputs.length,
        ]),
        "No hubs",
      ),
    )
  }
}

export class HubGetCommand extends RemoteCommand {
  static paths = [["hub", "get"]]

  static usage = Command.Usage({ category: "Backend API", description: "Gets a project hub." })

  id = Option.String({ required: true })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.projectModel.getProjectModel({ projectId: target.projectId })
    const hub = response.model?.hubs.find(value => value.id === this.id)
    if (!hub) {
      throw new Error(`Hub "${this.id}" not found`)
    }

    const result = { hub: toJson(HubSchema, hub, { useProtoFieldName: true }) }

    this.print(result, humanDetails(result))
  }
}

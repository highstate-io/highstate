import { toJson } from "@bufbuild/protobuf"
import { HubSchema, InstanceSchema } from "@highstate/api/v1"
import { Command, Option } from "clipanion"
import {
  hubInputSchema,
  hubPatchSchema,
  instanceInputSchema,
  instancePatchSchema,
  readDocument,
  toHub,
  toInstance,
} from "../shared"
import { RemoteCommand } from "./remote"

export class InstanceCreateCommand extends RemoteCommand {
  static paths = [["instance", "create"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Creates one resident instance.",
  })

  file = Option.String("--file", { required: true })

  async execute(): Promise<void> {
    const input = instanceInputSchema.parse(await readDocument(this.file))
    const { clients, target } = await this.remote()
    await clients.projectModel.createNodes({
      projectId: target.projectId,
      instances: [toInstance(input)],
    })

    this.print({}, `Created instance "${input.id}"`)
  }
}

export class InstanceUpdateCommand extends RemoteCommand {
  static paths = [["instance", "update"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Patches a resident instance.",
  })

  id = Option.String({ required: true })
  patch = Option.String("--patch", { required: true })

  async execute(): Promise<void> {
    const patch = instancePatchSchema.parse(await readDocument(this.patch))
    if (!Object.keys(patch).length) {
      throw new Error("Instance patch cannot be empty")
    }

    const { clients, target } = await this.remote()
    let position = patch.position
    if (position && (position.x === undefined || position.y === undefined)) {
      const response = await clients.projectModel.getProjectModel({ projectId: target.projectId })
      const current = response.model?.instances.find(value => value.id === this.id)?.position
      if (!current) {
        throw new Error(`Instance "${this.id}" has no position to patch`)
      }

      position = { x: position.x ?? current.x, y: position.y ?? current.y }
    }

    const response = await clients.projectModel.updateInstance({
      projectId: target.projectId,
      instance: toInstance({
        id: this.id,
        kind: "unit",
        type: "placeholder",
        name: "placeholder",
        ...patch,
        position,
      }),
      updateMask: {
        paths: Object.keys(patch).map(value => (value === "args" ? "arguments" : value)),
      },
    })

    this.print(
      {
        instance: response.instance
          ? toJson(InstanceSchema, response.instance, { useProtoFieldName: true })
          : undefined,
      },
      `Updated instance "${this.id}"`,
    )
  }
}

export class InstanceRenameCommand extends RemoteCommand {
  static paths = [["instance", "rename"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Renames a resident instance and its references.",
  })

  id = Option.String({ required: true })
  newName = Option.String({ required: true })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const response = await clients.projectModel.renameInstance({
      projectId: target.projectId,
      instanceId: this.id,
      newName: this.newName,
    })

    this.print(
      {
        instance: response.instance
          ? toJson(InstanceSchema, response.instance, { useProtoFieldName: true })
          : undefined,
      },
      `Renamed instance to "${response.instance?.id}"`,
    )
  }
}

export class InstanceDeleteCommand extends RemoteCommand {
  static paths = [["instance", "delete"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Deletes an instance from desired state without destroying its infrastructure.",
  })

  id = Option.String({ required: true })
  yes = Option.Boolean("--yes", false)

  async execute(): Promise<void> {
    if (!this.yes) {
      throw new Error(
        "Instance deletion requires --yes; destroy deployed infrastructure first when applicable",
      )
    }

    const { clients, target } = await this.remote()

    await clients.projectModel.deleteInstance({ projectId: target.projectId, instanceId: this.id })

    this.print({}, `Deleted instance "${this.id}" from desired state`)
  }
}

export class HubCreateCommand extends RemoteCommand {
  static paths = [["hub", "create"]]

  static usage = Command.Usage({ category: "Backend API", description: "Creates one hub." })

  file = Option.String("--file", { required: true })

  async execute(): Promise<void> {
    const input = hubInputSchema.parse(await readDocument(this.file))
    const { clients, target } = await this.remote()

    await clients.projectModel.createNodes({ projectId: target.projectId, hubs: [toHub(input)] })

    this.print({}, `Created hub "${input.id}"`)
  }
}

export class HubUpdateCommand extends RemoteCommand {
  static paths = [["hub", "update"]]

  static usage = Command.Usage({ category: "Backend API", description: "Patches a hub." })

  id = Option.String({ required: true })
  patch = Option.String("--patch", { required: true })

  async execute(): Promise<void> {
    const patch = hubPatchSchema.parse(await readDocument(this.patch))
    if (!Object.keys(patch).length) {
      throw new Error("Hub patch cannot be empty")
    }

    const { clients, target } = await this.remote()
    let position = patch.position
    if (position && (position.x === undefined || position.y === undefined)) {
      const response = await clients.projectModel.getProjectModel({ projectId: target.projectId })
      const current = response.model?.hubs.find(value => value.id === this.id)?.position
      if (!current) {
        throw new Error(`Hub "${this.id}" has no position to patch`)
      }

      position = { x: position.x ?? current.x, y: position.y ?? current.y }
    }

    const response = await clients.projectModel.updateHub({
      projectId: target.projectId,
      hub: toHub({
        id: this.id,
        ...patch,
        position:
          position && position.x !== undefined && position.y !== undefined
            ? { x: position.x, y: position.y }
            : undefined,
      }),
      updateMask: { paths: Object.keys(patch) },
    })

    this.print(
      {
        hub: response.hub
          ? toJson(HubSchema, response.hub, { useProtoFieldName: true })
          : undefined,
      },
      `Updated hub "${this.id}"`,
    )
  }
}

export class HubDeleteCommand extends RemoteCommand {
  static paths = [["hub", "delete"]]

  static usage = Command.Usage({ category: "Backend API", description: "Deletes a hub." })

  id = Option.String({ required: true })
  yes = Option.Boolean("--yes", false)

  async execute(): Promise<void> {
    if (!this.yes) {
      throw new Error("Hub deletion requires --yes")
    }

    const { clients, target } = await this.remote()

    await clients.projectModel.deleteHub({ projectId: target.projectId, hubId: this.id })

    this.print({}, `Deleted hub "${this.id}"`)
  }
}

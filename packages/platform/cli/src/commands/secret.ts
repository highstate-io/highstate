import { fromJson, type JsonObject, toJson } from "@bufbuild/protobuf"
import { StructSchema } from "@bufbuild/protobuf/wkt"
import {
  GetInstanceSecretsResponseSchema,
  GetSecretContentResponseSchema,
  GetSecretResponseSchema,
  ListSecretsResponseSchema,
} from "@highstate/api/v1"
import { Command, Option } from "clipanion"
import { humanDetails, messageJson, readDocument } from "../shared/remote"
import { RemoteCommand } from "./remote"

export class SecretListCommand extends RemoteCommand {
  static paths = [["secret", "list"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Lists secret metadata without values.",
  })

  stateId = Option.String("--state-id")
  serviceAccountId = Option.String("--service-account-id")
  search = Option.String("--search")
  pageSize = Option.String("--page-size")
  pageToken = Option.String("--page-token")

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()

    const response = await clients.secret.listSecrets({
      projectId: target.projectId,
      stateId: this.stateId,
      serviceAccountId: this.serviceAccountId,
      search: this.search,
      pageSize: Number(this.pageSize ?? 0),
      pageToken: this.pageToken,
    })

    const value = messageJson(ListSecretsResponseSchema, response)
    this.print(value, humanDetails(value))
  }
}

export class SecretGetCommand extends RemoteCommand {
  static paths = [["secret", "get"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Gets secret metadata, or explicitly reveals its value.",
  })

  id = Option.String({ required: true })
  reveal = Option.Boolean("--reveal", false)

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()
    const request = { projectId: target.projectId, secretId: this.id }

    const value = this.reveal
      ? messageJson(GetSecretContentResponseSchema, await clients.secret.getSecretContent(request))
      : messageJson(GetSecretResponseSchema, await clients.secret.getSecret(request))

    this.print(value, humanDetails(value))
  }
}

export class InstanceSecretsGetCommand extends RemoteCommand {
  static paths = [["instance", "secrets", "get"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Reveals named secret values for a unit state.",
  })

  stateId = Option.String({ required: true })

  async execute(): Promise<void> {
    const { clients, target } = await this.remote()

    const response = await clients.secret.getInstanceSecrets({
      projectId: target.projectId,
      stateId: this.stateId,
    })

    const value = messageJson(GetInstanceSecretsResponseSchema, response)
    this.print(value, humanDetails(value))
  }
}

export class InstanceSecretsUpdateCommand extends RemoteCommand {
  static paths = [["instance", "secrets", "update"]]

  static usage = Command.Usage({
    category: "Backend API",
    description:
      "Updates named secrets from a JSON or YAML file, or stdin (-), preserving omitted names.",
  })

  stateId = Option.String({ required: true })
  file = Option.String("--file", { required: true })

  async execute(): Promise<void> {
    const document = await readDocument(this.file)
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new Error("Secret values must be an object keyed by secret name")
    }

    const secrets = toJson(StructSchema, fromJson(StructSchema, document as JsonObject))
    const { clients, target } = await this.remote()

    await clients.secret.updateInstanceSecrets({
      projectId: target.projectId,
      stateId: this.stateId,
      secrets,
    })

    this.print({ updated: true }, "Secrets updated")
  }
}

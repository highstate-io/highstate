import type { SecretService } from "@highstate/api/v1"
import type { Services } from "@highstate/backend"
import { fromJson, type JsonObject, type JsonValue, toJson } from "@bufbuild/protobuf"
import { ValueSchema } from "@bufbuild/protobuf/wkt"
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect"
import { type SecretOutput, secretQuerySchema } from "@highstate/backend/shared"
import { z } from "@highstate/contract"
import { authenticateProject, parseArgument } from "../shared"

function toSecret(secret: SecretOutput) {
  return {
    id: secret.id,
    meta: fromJson(ValueSchema, secret.meta as JsonValue),
    name: secret.name ?? undefined,
    systemName: secret.systemName ?? undefined,
    stateId: secret.stateId ?? undefined,
    serviceAccountId: secret.serviceAccountId ?? undefined,
  }
}

export function createSecretService(services: Services): ServiceImpl<typeof SecretService> {
  return {
    async listSecrets(request, context) {
      const authorization = await authenticateProject(services, request, context)
      const query = parseArgument({ query: request }, "query", secretQuerySchema)
      const page = await services.secretSettingsService.query(authorization, query)
      return { secrets: page.items.map(toSecret), nextPageToken: page.nextPageToken }
    },
    async getSecret(request, context) {
      const authorization = await authenticateProject(services, request, context)
      const id = parseArgument(request, "secretId", z.cuid2())
      const secret = await services.secretSettingsService.get(authorization, id)

      if (!secret) {
        throw new ConnectError(`Secret "${id}" not found`, Code.NotFound)
      }

      return { secret: toSecret(secret) }
    },
    async getSecretContent(request, context) {
      const authorization = await authenticateProject(services, request, context)
      const id = parseArgument(request, "secretId", z.cuid2())
      const content = await services.secretSettingsService.getValue(authorization, id)
      return { content: fromJson(ValueSchema, content as JsonValue) }
    },
    async updateSecretContent(request, context) {
      const authorization = await authenticateProject(services, request, context)
      const secretId = parseArgument(request, "secretId", z.cuid2())

      if (!request.content) {
        throw new ConnectError("Secret content is required", Code.InvalidArgument)
      }

      await services.secretService.updateSecretContent(
        authorization,
        secretId,
        toJson(ValueSchema, request.content),
      )

      return {}
    },
    async getInstanceSecrets(request, context) {
      const authorization = await authenticateProject(services, request, context)
      const stateId = parseArgument(request, "stateId", z.cuid2())
      const secrets = await services.secretService.getInstanceSecretValues(authorization, stateId)
      return { secrets: secrets as JsonObject }
    },
    async updateInstanceSecrets(request, context) {
      const authorization = await authenticateProject(services, request, context)
      const stateId = parseArgument(request, "stateId", z.cuid2())

      if (!request.secrets) {
        throw new ConnectError("Secret values are required", Code.InvalidArgument)
      }

      await services.secretService.updateInstanceSecrets(authorization, stateId, request.secrets)

      return {}
    },
  }
}

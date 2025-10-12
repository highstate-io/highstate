import type { ApiKey, Services } from "@highstate/backend"
import { type CallContext, ServerError, Status } from "nice-grpc-common"

export async function authenticate(
  services: Services,
  context: CallContext,
): Promise<[projectId: string, apiKey: ApiKey]> {
  const token = context.metadata.get("api-key")
  if (!token) {
    throw new ServerError(Status.UNAUTHENTICATED, "No API key provided")
  }

  const projectId = context.metadata.get("project-id")
  if (!projectId) {
    throw new ServerError(Status.UNAUTHENTICATED, "No project ID provided")
  }

  const apiKey = await services.apiKeyService.getApiKeyByToken(projectId, token)

  return [projectId, apiKey]
}

import type { Logger } from "pino"
import type { BackendRequestContext, ProjectRequestContext } from "../common"
import type {
  ApiKey,
  BackendApiKey,
  BackendTransaction,
  DatabaseManager,
  ProjectTransaction,
} from "../database"
import type {
  ApiKeyOutput,
  ApiKeyTokenOutput,
  BackendApiKeyOutput,
  BackendApiKeyTokenOutput,
} from "../shared"
import { createHash } from "node:crypto"
import { createId } from "@paralleldrive/cuid2"
import { createProjectLogger, requireBackendPermission, requireProjectPermission } from "../common"
import {
  ApiKeyProjectMismatchError,
  BackendApiKeyNotFoundError,
  InvalidCredentialError,
  ProjectApiKeyNotFoundError,
  WorkerManagedApiKeyReadOnlyError,
} from "../shared"

export class ApiKeyService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly logger: Logger,
  ) {}

  /**
   * Regenerates the token for an API key in a project.
   *
   * @param projectId The ID of the project containing the API key.
   * @param apiKeyId The ID of the API key to regenerate.
   * @returns The updated API key and its new plaintext token.
   */
  async regenerateToken(
    projectId: string,
    apiKeyId: string,
  ): Promise<{ apiKey: ApiKey; token: string }> {
    const logger = createProjectLogger(this.logger, projectId)
    const database = await this.database.forProject(projectId)
    const { apiKey, token } = await rotateProjectApiKeyToken(database, apiKeyId)

    logger.info(`regenerated api key token with id "%s"`, apiKeyId)

    return { apiKey, token }
  }

  async rotateProjectApiKey(
    context: ProjectRequestContext,
    apiKeyId: string,
  ): Promise<ApiKeyTokenOutput> {
    const database = await this.database.forProject(context.projectId)
    const existing = await database.apiKey.findUnique({
      where: { id: apiKeyId },
      include: { serviceAccount: { select: { meta: true } }, worker: { select: { id: true } } },
    })

    if (!existing) {
      throw new ProjectApiKeyNotFoundError(context.projectId, apiKeyId)
    }

    requireProjectPermission(context, "api-key.rotate", {
      resourceId: existing.id,
      ownerServiceAccountId: existing.serviceAccountId,
      workerId: existing.worker?.id,
    })

    if (existing.worker) {
      throw new WorkerManagedApiKeyReadOnlyError(context.projectId, apiKeyId)
    }

    const { token } = await rotateProjectApiKeyToken(database, apiKeyId)
    const apiKey = await database.apiKey.findUniqueOrThrow({
      where: { id: apiKeyId },
      include: { serviceAccount: { select: { meta: true } }, worker: { select: { id: true } } },
    })
    return { apiKey: this.toProjectOutput(apiKey), token }
  }

  async rotateBackendApiKey(
    context: BackendRequestContext,
    apiKeyId: string,
  ): Promise<BackendApiKeyTokenOutput> {
    const existing = await this.database.backend.backendApiKey.findUnique({
      where: { id: apiKeyId },
      select: { id: true },
    })

    if (!existing) {
      throw new BackendApiKeyNotFoundError(apiKeyId)
    }

    requireBackendPermission(context, "api-key.rotate", { resourceId: existing.id })

    const { token } = await rotateBackendApiKeyToken(this.database.backend, apiKeyId)
    const apiKey = await this.database.backend.backendApiKey.findUniqueOrThrow({
      where: { id: apiKeyId },
      include: { serviceAccount: { select: { meta: true } } },
    })

    return {
      apiKey: {
        id: apiKey.id,
        meta: apiKey.meta,
        serviceAccountId: apiKey.serviceAccountId,
        serviceAccountMeta: apiKey.serviceAccount.meta,
        restrictionRules: apiKey.restrictionRules,
        expiresAt: apiKey.expiresAt,
        lastUsedAt: apiKey.lastUsedAt,
        createdAt: apiKey.createdAt,
        updatedAt: apiKey.updatedAt,
      } satisfies BackendApiKeyOutput,
      token,
    }
  }

  private toProjectOutput(apiKey: {
    id: string
    meta: ApiKeyOutput["meta"]
    serviceAccountId: string
    restrictionRules: ApiKeyOutput["restrictionRules"]
    expiresAt: Date | null
    lastUsedAt: Date | null
    createdAt: Date
    updatedAt: Date
    serviceAccount: { meta: NonNullable<ApiKeyOutput["serviceAccountMeta"]> }
    worker: { id: string } | null
  }): ApiKeyOutput {
    return {
      id: apiKey.id,
      meta: apiKey.meta,
      serviceAccountId: apiKey.serviceAccountId,
      serviceAccountMeta: apiKey.serviceAccount.meta,
      restrictionRules: apiKey.restrictionRules,
      expiresAt: apiKey.expiresAt,
      lastUsedAt: apiKey.lastUsedAt,
      createdAt: apiKey.createdAt,
      updatedAt: apiKey.updatedAt,
      managed: !!apiKey.worker,
    }
  }

  /**
   * Retrieves an API key by its token for a specific project.
   *
   * @param projectId The ID of the project containing the API key.
   * @param token The token of the API key to retrieve.
   * @returns The ProjectApiKey object if found.
   * @throws InvalidCredentialError if the token is not valid for the project.
   */
  async getApiKeyByToken(projectId: string, token: string): Promise<ApiKey> {
    const apiKeyId = parseApiKeyToken(token, "project")
    const database = await this.database.forProject(projectId)
    const apiKey = await database.apiKey.findFirst({
      where: {
        id: apiKeyId,
        tokenHash: hashApiKeyToken(token),
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    })

    if (!apiKey) {
      throw new InvalidCredentialError("project-api-key")
    }

    return await database.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    })
  }

  /**
   * Resolves a project authorization identity from a project or backend API key.
   *
   * Backend API keys assume the project service account bound to their backend service account.
   *
   * @param projectId The ID of the project being accessed.
   * @param token The project or backend API key token.
   * @returns The API key and project service account IDs.
   */
  async getProjectCredentialByToken(
    projectId: string,
    token: string,
  ): Promise<{
    id: string
    serviceAccountId: string
    restrictionRules: ApiKey["restrictionRules"]
  }> {
    if (!token.startsWith("hcb_")) {
      return await this.getApiKeyByToken(projectId, token)
    }

    const apiKey = await this.getBackendApiKeyByToken(token)
    const binding = await this.database.backend.backendServiceAccountProjectBinding.findUnique({
      where: {
        backendServiceAccountId_projectId: {
          backendServiceAccountId: apiKey.serviceAccountId,
          projectId,
        },
      },
      select: { projectServiceAccountId: true },
    })

    if (!binding) {
      throw new ApiKeyProjectMismatchError()
    }

    return {
      id: apiKey.id,
      serviceAccountId: binding.projectServiceAccountId,
      restrictionRules: [],
    }
  }

  /**
   * Retrieves a backend API key by its token.
   *
   * @param token The token of the backend API key to retrieve.
   * @returns The backend API key.
   * @throws InvalidCredentialError if the token is not valid.
   */
  async getBackendApiKeyByToken(token: string): Promise<{
    id: string
    serviceAccountId: string
    restrictionRules: BackendApiKey["restrictionRules"]
  }> {
    const apiKeyId = parseApiKeyToken(token, "backend")
    const apiKey = await this.database.backend.backendApiKey.findFirst({
      where: {
        id: apiKeyId,
        tokenHash: hashApiKeyToken(token),
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true, serviceAccountId: true, restrictionRules: true },
    })

    if (!apiKey) {
      throw new InvalidCredentialError("backend-api-key")
    }

    return await this.database.backend.backendApiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
      select: { id: true, serviceAccountId: true, restrictionRules: true },
    })
  }
}

export async function rotateProjectApiKeyToken(
  database: ProjectTransaction,
  apiKeyId: string,
): Promise<{ apiKey: ApiKey; token: string }> {
  const token = `hcp_${apiKeyId}_${createId()}`
  const apiKey = await database.apiKey.update({
    where: { id: apiKeyId },
    data: { tokenHash: hashApiKeyToken(token) },
  })

  return { apiKey, token }
}

export async function rotateBackendApiKeyToken(
  database: BackendTransaction,
  apiKeyId: string,
): Promise<{ token: string }> {
  const token = `hcb_${apiKeyId}_${createId()}`
  await database.backendApiKey.update({
    where: { id: apiKeyId },
    data: { tokenHash: hashApiKeyToken(token) },
  })

  return { token }
}

export function hashApiKeyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function parseApiKeyToken(token: string, realm: "project" | "backend"): string {
  const prefix = realm === "project" ? "hcp" : "hcb"
  const match = new RegExp(`^${prefix}_([a-z][0-9a-z]{23})_[a-z][0-9a-z]{23}$`).exec(token)
  if (!match) {
    throw new InvalidCredentialError(`${realm}-api-key`)
  }

  return match[1]!
}

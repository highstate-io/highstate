import type { Logger } from "pino"
import type { ApiKey, DatabaseManager } from "../database"
import { randomBytes } from "node:crypto"
import { createProjectLogger } from "../common"
import { AccessError } from "../shared"

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
   */
  async regenerateToken(projectId: string, apiKeyId: string): Promise<ApiKey> {
    const logger = createProjectLogger(this.logger, projectId)
    const database = await this.database.forProject(projectId)

    const apiKey = await database.apiKey.update({
      where: { id: apiKeyId },
      data: {
        token: randomBytes(32).toString("hex"),
      },
    })

    logger.info(`regenerated API key token with ID "%s",`, apiKeyId)

    return apiKey
  }

  /**
   * Retrieves an API key by its token for a specific project.
   *
   * @param projectId The ID of the project containing the API key.
   * @param token The token of the API key to retrieve.
   * @returns The ProjectApiKey object if found.
   * @throws AccessError if the token is not valid for the project.
   */
  async getApiKeyByToken(projectId: string, token: string): Promise<ApiKey> {
    const database = await this.database.forProject(projectId)
    const apiKey = await database.apiKey.findUnique({ where: { token } })

    if (!apiKey) {
      throw new AccessError(`API key token is not valid for project "${projectId}"`)
    }

    return apiKey
  }
}

import type { CommonObjectMeta } from "@highstate/contract"
import type { DatabaseManager } from "../database"
import type {
  ApiKeyWhereInput,
  ArtifactWhereInput,
  OperationWhereInput,
  PageWhereInput,
  SecretWhereInput,
  ServiceAccountWhereInput,
  TerminalWhereInput,
  TriggerWhereInput,
  UnlockMethodWhereInput,
  WorkerVersionWhereInput,
  WorkerWhereInput,
} from "../database/_generated/project/models"
import type {
  ApiKeyOutput,
  ApiKeyQuery,
  ArtifactOutput,
  ArtifactQuery,
  CollectionQuery,
  CollectionQueryResult,
  OperationOutput,
  OperationType,
  PageDetailsOutput,
  PageOutput,
  PageQuery,
  SecretOutput,
  SecretQuery,
  ServiceAccountOutput,
  ServiceAccountQuery,
  TerminalDetailsOutput,
  TerminalOutput,
  TerminalQuery,
  TerminalSessionOutput,
  TriggerOutput,
  TriggerQuery,
  UnlockMethodOutput,
  WorkerOutput,
  WorkerQuery,
  WorkerVersionOutput,
} from "../shared"
import {
  apiKeyOutputSchema,
  artifactOutputSchema,
  forSchema,
  operationOutputSchema,
  pageDetailsOutputSchema,
  pageOutputSchema,
  secretOutputSchema,
  serviceAccountOutputSchema,
  terminalDetailsOutputSchema,
  terminalOutputSchema,
  toApiKeyOutput,
  toPageOutput,
  toSecretOutput,
  toTerminalDetailsOutput,
  toTerminalOutput,
  toWorkerOutput,
  toWorkerVersionOutput,
  triggerOutputSchema,
  unlockMethodOutputSchema,
  workerOutputSchema,
  workerVersionOutputSchema,
} from "../shared"

export class SettingsService {
  constructor(private readonly database: DatabaseManager) {}

  private buildOperationWhere(query: CollectionQuery): OperationWhereInput {
    if (!query.search) return {}

    const searchTerm = query.search.toLowerCase()
    const OR: OperationWhereInput[] = [{ meta: { path: "title", string_contains: query.search } }]

    const matchingOperationTypes = ["update", "preview", "destroy", "recreate", "refresh"].filter(
      t => t.toLowerCase().includes(searchTerm),
    ) as OperationType[]

    if (matchingOperationTypes.length > 0) {
      OR.push({ type: { in: matchingOperationTypes } })
    }

    return { OR }
  }

  private buildTerminalWhere(query: TerminalQuery): TerminalWhereInput {
    const where: TerminalWhereInput = {}

    if (query.serviceAccountId) {
      where.serviceAccountId = query.serviceAccountId
    }

    if (query.stateId) {
      where.stateId = query.stateId
    }

    if (query.artifactId) {
      where.artifacts = {
        some: { id: query.artifactId },
      }
    }

    if (!query.search) return where

    return {
      ...where,
      OR: [
        { meta: { path: "title", string_contains: query.search } },
        { name: { contains: query.search } },
      ],
    }
  }

  private buildPageWhere(query: PageQuery): PageWhereInput {
    const where: PageWhereInput = {}

    if (query.serviceAccountId) {
      where.serviceAccountId = query.serviceAccountId
    }

    if (query.stateId) {
      where.stateId = query.stateId
    }

    if (query.artifactId) {
      where.artifacts = {
        some: { id: query.artifactId },
      }
    }

    if (!query.search) return where

    return {
      ...where,
      OR: [
        { meta: { path: "title", string_contains: query.search } },
        { name: { contains: query.search } },
      ],
    }
  }

  private buildSecretWhere(query: SecretQuery): SecretWhereInput {
    const where: SecretWhereInput = {}

    if (query.serviceAccountId) {
      where.serviceAccountId = query.serviceAccountId
    }

    if (query.stateId) {
      where.stateId = query.stateId
    }

    if (!query.search) return where

    return {
      ...where,
      OR: [
        { meta: { path: "title", string_contains: query.search } },
        { name: { contains: query.search } },
      ],
    }
  }

  private buildTriggerWhere(query: TriggerQuery): TriggerWhereInput {
    const where: TriggerWhereInput = {}

    if (query.stateId) {
      where.stateId = query.stateId
    }

    if (query.search) {
      where.OR = [
        { meta: { path: "title", string_contains: query.search } },
        { name: { contains: query.search } },
      ]
    }

    return where
  }

  private buildArtifactWhere(query: ArtifactQuery): ArtifactWhereInput {
    const where: ArtifactWhereInput = {}

    if (query.stateId) {
      where.instances = {
        some: { id: query.stateId },
      }
    }

    if (query.serviceAccountId) {
      where.serviceAccounts = {
        some: { id: query.serviceAccountId },
      }
    }

    if (query.terminalId) {
      where.terminals = {
        some: { id: query.terminalId },
      }
    }

    if (query.pageId) {
      where.pages = {
        some: { id: query.pageId },
      }
    }

    if (!query.search) return where

    return {
      ...where,
      OR: [
        { meta: { path: "title", string_contains: query.search } },
        { hash: { contains: query.search } },
      ],
    }
  }

  private buildWorkerWhere(query: WorkerQuery): WorkerWhereInput {
    const where: WorkerWhereInput = {}

    if (query.serviceAccountId) {
      where.serviceAccountId = query.serviceAccountId
    }

    if (!query.search) return where

    return {
      ...where,
      OR: [{ id: { contains: query.search } }, { identity: { contains: query.search } }],
    }
  }

  private buildWorkerVersionWhere(
    workerId: string,
    query: CollectionQuery,
  ): WorkerVersionWhereInput {
    const where: WorkerVersionWhereInput = { workerId }

    if (!query.search) return where

    return {
      ...where,
      OR: [
        { id: { contains: query.search } },
        { meta: { path: "title", string_contains: query.search } },
        { digest: { contains: query.search } },
      ],
    }
  }

  private buildUnlockMethodWhere(query: CollectionQuery): UnlockMethodWhereInput {
    if (!query.search) return {}

    const searchTerm = query.search.toLowerCase()
    const OR: UnlockMethodWhereInput[] = [
      { meta: { path: "title", string_contains: query.search } },
    ]

    const matchingTypes = ["password", "passkey"].filter(t =>
      t.toLowerCase().includes(searchTerm),
    ) as ("password" | "passkey")[]

    if (matchingTypes.length > 0) {
      OR.push({ type: { in: matchingTypes } })
    }

    return { OR }
  }

  private buildServiceAccountWhere(query: ServiceAccountQuery): ServiceAccountWhereInput {
    const where: ServiceAccountWhereInput = {}

    if (query.artifactId) {
      where.artifacts = {
        some: { id: query.artifactId },
      }
    }

    if (!query.search) return where

    return {
      ...where,
      OR: [
        { id: { contains: query.search } },
        { meta: { path: "title", string_contains: query.search } },
      ],
    }
  }

  private buildApiKeyWhere(query: ApiKeyQuery): ApiKeyWhereInput {
    const where: ApiKeyWhereInput = {}

    if (query.serviceAccountId) {
      where.serviceAccountId = query.serviceAccountId
    }

    if (!query.search) return where

    return {
      ...where,
      OR: [
        { id: { contains: query.search } },
        { meta: { path: "title", string_contains: query.search } },
        { serviceAccountId: { contains: query.search } },
      ],
    }
  }

  private buildTerminalSessionWhere(query: CollectionQuery, terminalId: string) {
    const baseWhere = { terminalId }

    if (!query.search) return baseWhere

    return {
      AND: [
        baseWhere,
        {
          OR: [{ id: { contains: query.search } }],
        },
      ],
    }
  }

  private buildOrderBy(query: CollectionQuery, defaultField: string) {
    if (!query.sortBy || query.sortBy.length === 0) {
      return { [defaultField]: "desc" }
    }

    if (query.sortBy.length === 1) {
      const sort = query.sortBy[0]
      return { [sort.key]: sort.order }
    }

    return query.sortBy.map(sort => ({ [sort.key]: sort.order }))
  }

  async queryOperations(
    projectId: string,
    query: CollectionQuery,
  ): Promise<CollectionQueryResult<OperationOutput>> {
    const db = await this.database.forProject(projectId)
    const whereClause = this.buildOperationWhere(query)

    const [total, items] = await Promise.all([
      db.operation.count({ where: whereClause }),
      db.operation.findMany({
        where: whereClause,
        orderBy: this.buildOrderBy(query, "startedAt"),
        skip: query.skip,
        take: query.count,
        select: forSchema(operationOutputSchema),
      }),
    ])

    return { items, total }
  }

  async queryTerminals(
    projectId: string,
    query: TerminalQuery,
  ): Promise<CollectionQueryResult<TerminalOutput>> {
    const db = await this.database.forProject(projectId)
    const whereClause = this.buildTerminalWhere(query)

    const [total, items] = await Promise.all([
      db.terminal.count({ where: whereClause }),
      db.terminal.findMany({
        where: whereClause,
        orderBy: this.buildOrderBy(query, "createdAt"),
        skip: query.skip,
        take: query.count,
        select: {
          ...forSchema(terminalOutputSchema.omit({ serviceAccountMeta: true })),
          serviceAccount: {
            select: { meta: true },
          },
        },
      }),
    ])

    const terminalOutputItems = items.map(item => toTerminalOutput(item, item.serviceAccount))
    return { items: terminalOutputItems, total }
  }

  async getTerminalDetails(
    projectId: string,
    terminalId: string,
  ): Promise<TerminalDetailsOutput | null> {
    const db = await this.database.forProject(projectId)

    const terminal = await db.terminal.findUnique({
      where: { id: terminalId },
      select: {
        ...forSchema(terminalDetailsOutputSchema.omit({ serviceAccountMeta: true })),
        serviceAccount: {
          select: { meta: true },
        },
      },
    })

    if (!terminal) return null
    return toTerminalDetailsOutput(terminal, terminal?.serviceAccount)
  }

  async getServiceAccountDetails(
    projectId: string,
    serviceAccountId: string,
  ): Promise<ServiceAccountOutput | null> {
    const db = await this.database.forProject(projectId)

    const serviceAccount = await db.serviceAccount.findUnique({
      where: { id: serviceAccountId },
      select: forSchema(serviceAccountOutputSchema),
    })

    return serviceAccount
  }

  async getApiKeyDetails(projectId: string, apiKeyId: string): Promise<ApiKeyOutput | null> {
    const db = await this.database.forProject(projectId)

    const apiKey = await db.apiKey.findUnique({
      where: { id: apiKeyId },
      select: {
        ...forSchema(apiKeyOutputSchema.omit({ serviceAccountMeta: true })),
        serviceAccount: {
          select: { meta: true },
        },
      },
    })

    if (!apiKey) return null

    return toApiKeyOutput(apiKey, apiKey.serviceAccount)
  }

  async getWorkerDetails(projectId: string, workerId: string): Promise<WorkerOutput | null> {
    const db = await this.database.forProject(projectId)

    const worker = await db.worker.findUnique({
      where: { id: workerId },
      select: {
        ...forSchema(workerOutputSchema.omit({ meta: true, serviceAccountMeta: true })),
        serviceAccount: {
          select: { meta: true },
        },
        versions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { meta: true },
        },
      },
    })

    if (!worker) return null

    const lastVersion = worker.versions?.[0] ?? null
    return toWorkerOutput(worker, lastVersion, worker.serviceAccount)
  }

  async getWorkerVersionDetails(
    projectId: string,
    versionId: string,
  ): Promise<WorkerVersionOutput | null> {
    const db = await this.database.forProject(projectId)

    const version = await db.workerVersion.findUnique({
      where: { id: versionId },
      select: {
        ...forSchema(workerVersionOutputSchema.omit({ apiKeyMeta: true })),
        apiKey: {
          select: { meta: true },
        },
      },
    })

    if (!version) return null

    return toWorkerVersionOutput(version, version.apiKey)
  }

  async getPageDetails(projectId: string, pageId: string): Promise<PageDetailsOutput | null> {
    const db = await this.database.forProject(projectId)

    const page = await db.page.findUnique({
      where: { id: pageId },
      select: {
        ...forSchema(pageDetailsOutputSchema.omit({ serviceAccountMeta: true })),
        serviceAccount: {
          select: { meta: true },
        },
      },
    })

    if (!page) return null

    return {
      ...toPageOutput(page, page.serviceAccount),
      content: page.content,
    }
  }

  async getSecretDetails(projectId: string, secretId: string): Promise<SecretOutput | null> {
    const db = await this.database.forProject(projectId)

    const secret = await db.secret.findUnique({
      where: { id: secretId },
      select: {
        ...forSchema(secretOutputSchema.omit({ serviceAccountMeta: true })),
        serviceAccount: {
          select: { meta: true },
        },
      },
    })

    if (!secret) return null

    return toSecretOutput(secret, secret.serviceAccount)
  }

  async getSecretValue(projectId: string, secretId: string): Promise<unknown> {
    const db = await this.database.forProject(projectId)

    const secret = await db.secret.findUnique({
      where: { id: secretId },
      select: {
        content: true,
      },
    })

    if (!secret) return null

    return secret.content
  }

  async getArtifactDetails(projectId: string, artifactId: string): Promise<ArtifactOutput | null> {
    const db = await this.database.forProject(projectId)

    const artifact = await db.artifact.findUnique({
      where: { id: artifactId },
      select: forSchema(artifactOutputSchema),
    })

    return artifact
  }

  async getOperationDetails(
    projectId: string,
    operationId: string,
  ): Promise<OperationOutput | null> {
    const db = await this.database.forProject(projectId)

    const operation = await db.operation.findUnique({
      where: { id: operationId },
      select: forSchema(operationOutputSchema),
    })

    return operation
  }

  async getTriggerDetails(projectId: string, triggerId: string): Promise<TriggerOutput | null> {
    const db = await this.database.forProject(projectId)

    const trigger = await db.trigger.findUnique({
      where: { id: triggerId },
      select: forSchema(triggerOutputSchema),
    })

    return trigger
  }

  async getUnlockMethodDetails(
    projectId: string,
    unlockMethodId: string,
  ): Promise<UnlockMethodOutput | null> {
    const db = await this.database.forProject(projectId)

    const unlockMethod = await db.unlockMethod.findUnique({
      where: { id: unlockMethodId },
      select: forSchema(unlockMethodOutputSchema),
    })

    return unlockMethod
  }

  async getTerminalSessions(
    projectId: string,
    terminalId: string,
    query: CollectionQuery,
  ): Promise<CollectionQueryResult<TerminalSessionOutput>> {
    const db = await this.database.forProject(projectId)

    const whereClause = this.buildTerminalSessionWhere(query, terminalId)

    const [total, sessions] = await Promise.all([
      db.terminalSession.count({ where: whereClause }),
      db.terminalSession.findMany({
        where: whereClause,
        include: {
          terminal: {
            select: {
              meta: true,
            },
          },
        },
        orderBy: this.buildOrderBy(query, "startedAt"),
        skip: query.skip,
        take: query.count,
      }),
    ])

    const items = sessions.map(session => ({
      id: session.id,
      terminalId: session.terminalId,
      meta: session.terminal.meta as CommonObjectMeta,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
    }))

    return { items, total }
  }

  async queryPages(
    projectId: string,
    query: PageQuery,
  ): Promise<CollectionQueryResult<PageOutput>> {
    const db = await this.database.forProject(projectId)
    const whereClause = this.buildPageWhere(query)

    const [total, items] = await Promise.all([
      db.page.count({ where: whereClause }),
      db.page.findMany({
        where: whereClause,
        orderBy: this.buildOrderBy(query, "createdAt"),
        skip: query.skip,
        take: query.count,
        select: {
          ...forSchema(pageOutputSchema.omit({ serviceAccountMeta: true })),
          serviceAccount: {
            select: { meta: true },
          },
        },
      }),
    ])

    const pageOutputItems = items.map(item => toPageOutput(item, item.serviceAccount))
    return { items: pageOutputItems, total }
  }

  async querySecrets(
    projectId: string,
    query: SecretQuery,
  ): Promise<CollectionQueryResult<SecretOutput>> {
    const db = await this.database.forProject(projectId)
    const whereClause = this.buildSecretWhere(query)

    const [total, items] = await Promise.all([
      db.secret.count({ where: whereClause }),
      db.secret.findMany({
        where: whereClause,
        orderBy: this.buildOrderBy(query, "createdAt"),
        skip: query.skip,
        take: query.count,
        select: {
          ...forSchema(secretOutputSchema.omit({ serviceAccountMeta: true })),
          serviceAccount: {
            select: { meta: true },
          },
        },
      }),
    ])

    const secretOutputItems = items.map(item => toSecretOutput(item, item.serviceAccount))
    return { items: secretOutputItems, total }
  }

  async queryTriggers(
    projectId: string,
    query: TriggerQuery,
  ): Promise<CollectionQueryResult<TriggerOutput>> {
    const db = await this.database.forProject(projectId)
    const whereClause = this.buildTriggerWhere(query)

    const [total, items] = await Promise.all([
      db.trigger.count({ where: whereClause }),
      db.trigger.findMany({
        where: whereClause,
        orderBy: this.buildOrderBy(query, "createdAt"),
        skip: query.skip,
        take: query.count,
        select: forSchema(triggerOutputSchema),
      }),
    ])

    return { items, total }
  }

  async queryArtifacts(
    projectId: string,
    query: ArtifactQuery,
  ): Promise<CollectionQueryResult<ArtifactOutput>> {
    const db = await this.database.forProject(projectId)
    const whereClause = this.buildArtifactWhere(query)

    const [total, items] = await Promise.all([
      db.artifact.count({ where: whereClause }),
      db.artifact.findMany({
        where: whereClause,
        orderBy: this.buildOrderBy(query, "createdAt"),
        skip: query.skip,
        take: query.count,
        select: forSchema(artifactOutputSchema),
      }),
    ])

    return { items, total }
  }

  async queryWorkers(
    projectId: string,
    query: WorkerQuery,
  ): Promise<CollectionQueryResult<WorkerOutput>> {
    const db = await this.database.forProject(projectId)
    const whereClause = this.buildWorkerWhere(query)

    const [total, items] = await Promise.all([
      db.worker.count({ where: whereClause }),
      db.worker.findMany({
        where: whereClause,
        orderBy: this.buildOrderBy(query, "createdAt"),
        skip: query.skip,
        take: query.count,
        select: {
          ...forSchema(workerOutputSchema.omit({ meta: true, serviceAccountMeta: true })),
          serviceAccount: {
            select: { meta: true },
          },
          versions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { meta: true },
          },
        },
      }),
    ])

    const workerOutputItems = items.map(item => {
      const lastVersion = item.versions?.[0] ?? null

      return toWorkerOutput(item, lastVersion, item.serviceAccount)
    })

    return { items: workerOutputItems, total }
  }

  async queryWorkerVersions(
    projectId: string,
    workerId: string,
    query: CollectionQuery,
  ): Promise<CollectionQueryResult<WorkerVersionOutput>> {
    const db = await this.database.forProject(projectId)
    const whereClause = this.buildWorkerVersionWhere(workerId, query)

    const [total, items] = await Promise.all([
      db.workerVersion.count({ where: whereClause }),
      db.workerVersion.findMany({
        where: whereClause,
        orderBy: this.buildOrderBy(query, "createdAt"),
        skip: query.skip,
        take: query.count,
        select: {
          ...forSchema(workerVersionOutputSchema.omit({ apiKeyMeta: true })),
          apiKey: {
            select: { meta: true },
          },
        },
      }),
    ])

    const outputItems = items.map(item => toWorkerVersionOutput(item, item.apiKey))

    return { items: outputItems, total }
  }

  async queryUnlockMethods(
    projectId: string,
    query: CollectionQuery,
  ): Promise<CollectionQueryResult<UnlockMethodOutput>> {
    const db = await this.database.forProject(projectId)
    const whereClause = this.buildUnlockMethodWhere(query)

    const [total, items] = await Promise.all([
      db.unlockMethod.count({ where: whereClause }),
      db.unlockMethod.findMany({
        where: whereClause,
        orderBy: this.buildOrderBy(query, "createdAt"),
        skip: query.skip,
        take: query.count,
        select: forSchema(unlockMethodOutputSchema),
      }),
    ])

    return { items, total }
  }

  async queryServiceAccounts(
    projectId: string,
    query: ServiceAccountQuery,
  ): Promise<CollectionQueryResult<ServiceAccountOutput>> {
    const db = await this.database.forProject(projectId)
    const whereClause = this.buildServiceAccountWhere(query)

    const [total, items] = await Promise.all([
      db.serviceAccount.count({ where: whereClause }),
      db.serviceAccount.findMany({
        where: whereClause,
        orderBy: this.buildOrderBy(query, "createdAt"),
        skip: query.skip,
        take: query.count,
      }),
    ])

    return { items, total }
  }

  async queryApiKeys(
    projectId: string,
    query: ApiKeyQuery,
  ): Promise<CollectionQueryResult<ApiKeyOutput>> {
    const db = await this.database.forProject(projectId)
    const whereClause = this.buildApiKeyWhere(query)

    const [total, items] = await Promise.all([
      db.apiKey.count({ where: whereClause }),
      db.apiKey.findMany({
        where: whereClause,
        orderBy: this.buildOrderBy(query, "createdAt"),
        skip: query.skip,
        take: query.count,
        select: {
          ...forSchema(apiKeyOutputSchema.omit({ serviceAccountMeta: true })),
          serviceAccount: {
            select: { meta: true },
          },
        },
      }),
    ])

    const apiKeyOutputItems = items.map(item => toApiKeyOutput(item, item.serviceAccount))

    return { items: apiKeyOutputItems, total }
  }
}

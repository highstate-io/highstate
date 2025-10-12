import type { RunnerBackend } from "./runner"
import { createId } from "@paralleldrive/cuid2"
import { type Logger, pino } from "pino"
import { type ArtifactBackend, ArtifactService, createArtifactBackend } from "./artifact"
import {
  ApiKeyService,
  BackendUnlockService,
  InstanceLockService,
  InstanceStateService,
  OperationService,
  ProjectModelService,
  ProjectService,
  ProjectUnlockService,
  SecretService,
  SettingsService,
  TerminalSessionService,
  UnitExtraService,
  WorkerService,
} from "./business"
import { ProjectEvaluationSubsystem } from "./business/evaluation"
import { type Config, loadConfig } from "./config"
import {
  createBackendDatabaseBackend,
  createProjectDatabaseBackend,
  type DatabaseManager,
  DatabaseManagerImpl,
} from "./database"
import { createLibraryBackend, type LibraryBackend } from "./library"
import { createLockBackend, type LockBackend, LockManager } from "./lock"
import { OperationManager } from "./orchestrator"
import { createProjectModelBackends, type ProjectModelBackend } from "./project-model"
import { createPubSubBackend, type PubSubBackend, PubSubManager } from "./pubsub"
import { createRunnerBackend } from "./runner"
import { createTerminalBackend, type TerminalBackend, TerminalManager } from "./terminal"
import { MemoryProjectUnlockBackend, type ProjectUnlockBackend } from "./unlock"
import { createWorkerBackend, type WorkerBackend, WorkerManager } from "./worker"

export type Services = {
  /**
   * The runtime ID of this backend.
   *
   * Generated on each start and used to track terminals and workers running by this backend.
   */
  readonly runtimeId: string

  readonly logger: Logger

  readonly database: DatabaseManager

  readonly projectUnlockBackend: ProjectUnlockBackend

  readonly pubsubBackend: PubSubBackend
  readonly pubsubManager: PubSubManager

  readonly lockBackend: LockBackend
  readonly lockManager: LockManager

  readonly libraryBackend: LibraryBackend
  readonly runnerBackend: RunnerBackend

  readonly projectModelBackends: Record<string, ProjectModelBackend>
  readonly projectEvaluationSubsystem: ProjectEvaluationSubsystem

  readonly operationManager: OperationManager

  readonly terminalBackend: TerminalBackend
  readonly terminalManager: TerminalManager
  readonly terminalSessionService: TerminalSessionService

  readonly workerBackend: WorkerBackend
  readonly workerManager: WorkerManager

  readonly artifactBackend: ArtifactBackend

  // business services
  readonly backendUnlockService: BackendUnlockService
  readonly instanceLockService: InstanceLockService
  readonly projectUnlockService: ProjectUnlockService
  readonly operationService: OperationService
  readonly instanceStateService: InstanceStateService
  readonly secretService: SecretService
  readonly apiKeyService: ApiKeyService
  readonly workerService: WorkerService
  readonly projectModelService: ProjectModelService
  readonly projectService: ProjectService
  readonly artifactService: ArtifactService
  readonly settingsService: SettingsService
  readonly unitExtraService: UnitExtraService
}

export interface CreateServicesOptions {
  /**
   * The config to use. If not provided, it will be loaded from the environment.
   */
  readonly config?: Config

  /**
   * The already created services to use. If the particular service is not provided, it will be created.
   */
  readonly services?: Partial<Services>
}

export async function createServices({
  config,
  services: {
    runtimeId,
    logger,

    database,
    projectUnlockBackend,

    pubsubBackend,
    pubsubManager,

    lockBackend,
    lockManager,

    libraryBackend,
    runnerBackend,

    projectModelBackends,
    projectEvaluationSubsystem,

    operationManager,

    terminalBackend,
    terminalManager,

    workerBackend,
    workerManager,

    artifactBackend,
    artifactService,

    // business services
    backendUnlockService,
    instanceLockService,
    projectUnlockService,
    operationService,
    secretService,
    terminalSessionService: sessionService,
    instanceStateService,
    apiKeyService,
    workerService,
    projectService,
    projectModelService,
    settingsService,
    unitExtraService,
  } = {},
}: CreateServicesOptions = {}): Promise<Services> {
  runtimeId ??= createId()
  config ??= await loadConfig()

  logger ??= pino({ level: config.HIGHSTATE_LOG_LEVEL, errorKey: "error" })

  projectUnlockBackend ??= new MemoryProjectUnlockBackend()

  const backendDatabaseBackend = await createBackendDatabaseBackend(config, logger)
  const projectDatabaseBackend = await createProjectDatabaseBackend(config, logger)

  database ??= new DatabaseManagerImpl(
    backendDatabaseBackend,
    projectUnlockBackend,
    projectDatabaseBackend,
    config,
    logger,
  )

  pubsubBackend ??= createPubSubBackend(config, logger)
  pubsubManager ??= new PubSubManager(pubsubBackend, logger)

  lockBackend ??= createLockBackend(config)
  lockManager ??= new LockManager(lockBackend)

  libraryBackend ??= await createLibraryBackend(config, logger)

  artifactBackend ??= await createArtifactBackend(config, database, logger)
  artifactService ??= new ArtifactService(database, artifactBackend, logger)

  backendUnlockService ??= new BackendUnlockService(
    database,
    logger.child({ service: "BackendUnlockService" }),
  )

  secretService ??= new SecretService(
    database,
    pubsubManager,
    libraryBackend,
    logger.child({ service: "SecretService" }),
  )
  sessionService ??= new TerminalSessionService(database)

  runnerBackend ??= createRunnerBackend(
    config,
    libraryBackend,
    artifactService,
    artifactBackend,
    secretService,
    logger,
  )

  projectModelBackends ??= await createProjectModelBackends(database, logger)

  instanceLockService ??= new InstanceLockService(
    database,
    pubsubManager,
    logger.child({ service: "InstanceLockService" }),
  )

  projectUnlockService ??= new ProjectUnlockService(
    database,
    pubsubManager,
    projectUnlockBackend,
    config,
    logger.child({ service: "StateUnlockService" }),
  )

  operationService ??= new OperationService(
    database,
    pubsubManager,
    logger.child({ service: "OperationService" }),
  )

  apiKeyService ??= new ApiKeyService(database, logger.child({ service: "ApiKeyService" }))

  terminalBackend ??= createTerminalBackend(config, logger)
  terminalManager ??= TerminalManager.create(
    terminalBackend,
    database,
    pubsubManager,
    projectUnlockService,
    logger,
  )

  workerBackend ??= createWorkerBackend(config, logger)
  workerManager ??= new WorkerManager(
    config,
    runtimeId,
    workerBackend,
    projectUnlockService,
    apiKeyService,
    database,
    pubsubManager,
    logger,
  )

  workerService ??= new WorkerService(
    database,
    workerManager,
    pubsubManager,
    logger.child({ service: "WorkerService" }),
  )

  unitExtraService ??= new UnitExtraService(database)
  settingsService ??= new SettingsService(database)

  instanceStateService ??= new InstanceStateService(
    database,
    pubsubManager,
    runnerBackend,
    workerService,
    artifactService,
    unitExtraService,
    secretService,
    logger.child({ service: "InstanceService" }),
  )

  projectModelService ??= new ProjectModelService(
    database,
    libraryBackend,
    instanceStateService,
    projectModelBackends,
    projectUnlockService,
    logger.child({ service: "ProjectModelService" }),
  )

  projectEvaluationSubsystem ??= new ProjectEvaluationSubsystem(
    database,
    libraryBackend,
    projectModelService,
    pubsubManager,
    projectUnlockService,
    logger,
  )

  projectService ??= new ProjectService(
    database,
    projectUnlockService,
    projectEvaluationSubsystem,
    projectModelService,
    projectModelBackends,
    libraryBackend,
    pubsubManager,
    logger.child({ service: "ProjectService" }),
  )

  operationManager ??= new OperationManager(
    runnerBackend,
    libraryBackend,
    artifactService,
    instanceLockService,
    projectUnlockService,
    operationService,
    secretService,
    instanceStateService,
    projectModelService,
    unitExtraService,
    database,
    logger,
  )

  logger.info("services created")

  return {
    runtimeId,
    logger,

    database,

    projectUnlockBackend,

    pubsubBackend,
    pubsubManager,

    lockBackend,
    lockManager,

    libraryBackend,
    runnerBackend,

    projectModelBackends,
    projectEvaluationSubsystem,

    operationManager,

    terminalBackend,
    terminalManager,

    workerBackend,
    workerManager,

    artifactBackend,
    artifactService,

    // business services
    backendUnlockService,
    instanceLockService,
    projectUnlockService,
    operationService,
    instanceStateService,
    secretService,
    terminalSessionService: sessionService,
    apiKeyService,
    workerService,
    projectService,
    projectModelService,
    settingsService,
    unitExtraService,
  }
}

let sharedServicesPromise: Promise<Services> | undefined

export function getSharedServices(options: CreateServicesOptions = {}): Promise<Services> {
  if (!sharedServicesPromise) {
    sharedServicesPromise = createServices(options)
  }

  return sharedServicesPromise
}

/**
 * Disposes all the services that implement `Symbol.dispose` or `Symbol.asyncDispose`.
 *
 * Must only be called once when the backend is shutting down and when no other code is using the services.
 *
 * @param services The services to dispose
 */
export async function disposeServices(services: Services): Promise<void> {
  const promises: Promise<unknown>[] = []

  for (const [key, service] of Object.entries(services)) {
    if (typeof service !== "object" || service === null) {
      continue
    }

    if (Symbol.dispose in service) {
      // sync dispose
      try {
        ;(service as Disposable)[Symbol.dispose]()
      } catch (error) {
        services.logger.error({ error }, `failed to dispose service "%s"`, key)
      }
    }

    if (Symbol.asyncDispose in service) {
      // async dispose
      const disposeAsync = async () => {
        try {
          await (service as AsyncDisposable)[Symbol.asyncDispose]()
        } catch (error) {
          services.logger.error({ error }, `failed to async dispose service "%s"`, key)
        }
      }

      promises.push(disposeAsync())
    }
  }

  await Promise.all(promises)
}

import type { RunnerBackend } from "./runner"
import { randomBytes } from "node:crypto"
import { createId } from "@paralleldrive/cuid2"
import { type Logger, pino } from "pino"
import { type ArtifactBackend, ArtifactService, createArtifactBackend } from "./artifact"
import {
  ApiKeyService,
  ArtifactSettingsService,
  BackendApiKeySettingsService,
  BackendRoleSettingsService,
  BackendServiceAccountSettingsService,
  BackendUnlockService,
  EntitySettingsService,
  EntitySnapshotService,
  GlobalSearchService,
  InstanceLockService,
  InstanceStateService,
  LibraryService,
  ObjectRefIndexService,
  OperationService,
  OperationSettingsService,
  PageSettingsService,
  PanelService,
  PanelSettingsService,
  ProjectApiKeySettingsService,
  ProjectLibraryService,
  ProjectModelService,
  ProjectPortService,
  ProjectRoleSettingsService,
  ProjectService,
  ProjectServiceAccountSettingsService,
  ProjectUnlockService,
  RuntimeSettingsService,
  SecretService,
  SecretSettingsService,
  TerminalSessionService,
  TerminalSettingsService,
  TriggerSettingsService,
  UnitExtraService,
  UnitOutputService,
  UnlockMethodSettingsService,
  WorkerService,
  WorkerSettingsService,
} from "./business"
import { ProjectEvaluationSubsystem } from "./business/evaluation"
import { type Config, loadConfig } from "./config"
import {
  AgentConnectionRegistry,
  BackendRuntimeSecrets,
  DatabaseRuntimeAdapterProvider,
  DatabaseSnapshotImageConfiguration,
  RuntimeCoordinator,
  RuntimeCredentialSigner,
  RuntimeMaintenance,
  RuntimePreflightProviderBridge,
  RuntimeSettingsPreflightBridge,
  RuntimeWorkloadProbe,
  SnapshotImageManager,
  WorkerProxyRegistry,
} from "./container-runtime"
import {
  createBackendDatabaseBackend,
  createProjectDatabaseBackend,
  type DatabaseManager,
  DatabaseManagerImpl,
} from "./database"
import {
  createLibraryBackend,
  type LibraryBackend,
  NpmProjectLibraryResolver,
  PrismaProjectLibraryStore,
  ProjectLibraryGarbageCollector,
  RuntimeProjectLibraryCatalogProvider,
  RuntimeProjectNpmRegistryProvider,
} from "./library"
import { createLockBackend, type LockBackend, LockManager } from "./lock"
import { OperationManager } from "./orchestrator"
import { PanelEndpointManager } from "./panel"
import { createProjectModelBackends, type ProjectModelBackend } from "./project-model"
import { createPubSubBackend, type PubSubBackend, PubSubManager } from "./pubsub"
import {
  createRunnerBackend,
  DatabasePulumiActionConfiguration,
  LazyRunnerBackend,
  RuntimeArtifactTransfer,
  RuntimeEvaluationBackend,
  RuntimeExecutionService,
  RuntimeSidecarManager,
} from "./runner"
import { createTerminalBackend, type TerminalBackend, TerminalManager } from "./terminal"
import { MemoryProjectUnlockBackend, type ProjectUnlockBackend } from "./unlock"
import { createWorkerBackend, type WorkerBackend, WorkerManager } from "./worker"

export type Services = {
  /**
   * The stable ID derived from the backend federation key.
   */
  readonly backendId: string

  /**
   * The AGE identity used for backend federation cryptography.
   */
  readonly privateKey: string

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
  readonly runtimeCoordinator: RuntimeCoordinator
  readonly runtimeCredentialSigner: RuntimeCredentialSigner
  readonly workerProxyRegistry: WorkerProxyRegistry
  readonly runtimeArtifactTransfer: RuntimeArtifactTransfer
  readonly projectLibraryService: ProjectLibraryService
  readonly runtimeSettingsService: RuntimeSettingsService
  readonly runtimeMaintenance: RuntimeMaintenance

  readonly projectModelBackends: Record<string, ProjectModelBackend>
  readonly projectEvaluationSubsystem: ProjectEvaluationSubsystem

  readonly operationManager: OperationManager

  readonly terminalBackend: TerminalBackend
  readonly terminalManager: TerminalManager
  readonly terminalSessionService: TerminalSessionService
  readonly workerBackend: WorkerBackend
  readonly workerManager: WorkerManager

  readonly artifactBackend: ArtifactBackend
  readonly panelEndpointManager: PanelEndpointManager

  // business services
  readonly backendUnlockService: BackendUnlockService
  readonly backendApiKeySettingsService: BackendApiKeySettingsService
  readonly backendRoleSettingsService: BackendRoleSettingsService
  readonly backendServiceAccountSettingsService: BackendServiceAccountSettingsService
  readonly projectApiKeySettingsService: ProjectApiKeySettingsService
  readonly projectRoleSettingsService: ProjectRoleSettingsService
  readonly projectServiceAccountSettingsService: ProjectServiceAccountSettingsService
  readonly globalSearchService: GlobalSearchService
  readonly instanceLockService: InstanceLockService
  readonly objectRefIndexService: ObjectRefIndexService
  readonly projectUnlockService: ProjectUnlockService
  readonly operationService: OperationService
  readonly panelService: PanelService
  readonly instanceStateService: InstanceStateService
  readonly secretService: SecretService
  readonly apiKeyService: ApiKeyService
  readonly workerService: WorkerService
  readonly projectModelService: ProjectModelService
  readonly projectService: ProjectService
  readonly libraryService: LibraryService
  readonly projectPortService: ProjectPortService
  readonly artifactService: ArtifactService
  readonly operationSettingsService: OperationSettingsService
  readonly terminalSettingsService: TerminalSettingsService
  readonly pageSettingsService: PageSettingsService
  readonly panelSettingsService: PanelSettingsService
  readonly secretSettingsService: SecretSettingsService
  readonly triggerSettingsService: TriggerSettingsService
  readonly artifactSettingsService: ArtifactSettingsService
  readonly workerSettingsService: WorkerSettingsService
  readonly entitySettingsService: EntitySettingsService
  readonly unlockMethodSettingsService: UnlockMethodSettingsService
  readonly unitExtraService: UnitExtraService
  readonly entitySnapshotService: EntitySnapshotService
  readonly unitOutputService: UnitOutputService
}

export type CreateServicesOptions = {
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
    backendId,
    privateKey,
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
    runtimeCoordinator,
    runtimeCredentialSigner,
    workerProxyRegistry,
    runtimeArtifactTransfer,
    projectLibraryService,
    runtimeSettingsService,
    runtimeMaintenance,

    projectModelBackends,
    projectEvaluationSubsystem,

    operationManager,

    terminalBackend,
    terminalManager,

    workerBackend,
    workerManager,

    artifactBackend,
    artifactService,
    panelEndpointManager,

    // business services
    backendUnlockService,
    backendApiKeySettingsService,
    backendRoleSettingsService,
    backendServiceAccountSettingsService,
    projectApiKeySettingsService,
    projectRoleSettingsService,
    projectServiceAccountSettingsService,
    globalSearchService,
    instanceLockService,
    objectRefIndexService,
    projectUnlockService,
    operationService,
    panelService,
    secretService,
    terminalSessionService: sessionService,
    instanceStateService,
    apiKeyService,
    workerService,
    projectService,
    projectModelService,
    libraryService,
    projectPortService,
    operationSettingsService,
    terminalSettingsService,
    pageSettingsService,
    panelSettingsService,
    secretSettingsService,
    triggerSettingsService,
    artifactSettingsService,
    workerSettingsService,
    entitySettingsService,
    unlockMethodSettingsService,
    unitExtraService,
    entitySnapshotService,
    unitOutputService,
  } = {},
}: CreateServicesOptions = {}): Promise<Services> {
  runtimeId ??= createId()
  config ??= await loadConfig()

  logger ??= pino({ level: config.HIGHSTATE_LOG_LEVEL, errorKey: "error" })

  projectUnlockBackend ??= new MemoryProjectUnlockBackend()

  const backendDatabaseBackend = await createBackendDatabaseBackend(config, logger)
  backendId ??= backendDatabaseBackend.backendId
  privateKey ??= backendDatabaseBackend.privateKey
  const projectDatabaseBackend = await createProjectDatabaseBackend(config, logger)

  database ??= new DatabaseManagerImpl(
    backendDatabaseBackend,
    projectUnlockBackend,
    projectDatabaseBackend,
    config,
    logger,
  )

  const runtimeSecrets = new BackendRuntimeSecrets(database, privateKey)
  const runtimeAdapters = new DatabaseRuntimeAdapterProvider(database, runtimeSecrets)
  runtimeCredentialSigner ??= new RuntimeCredentialSigner(backendId, randomBytes(32))
  runtimeCoordinator ??= new RuntimeCoordinator(
    database,
    runtimeAdapters,
    runtimeCredentialSigner,
    new AgentConnectionRegistry(),
    backendId,
  )
  workerProxyRegistry ??= new WorkerProxyRegistry(
    runtimeCoordinator.connections,
    async connection => {
      await runtimeCoordinator!.authenticate(connection)
    },
  )
  runtimeSettingsService ??= new RuntimeSettingsService(
    database,
    privateKey,
    new RuntimePreflightProviderBridge(
      database,
      new RuntimeSettingsPreflightBridge(runtimeSecrets),
      async runtimeId => ({
        registryImage: config.HIGHSTATE_RUNNER_BASE_IMAGE,
        probe: signal =>
          new RuntimeWorkloadProbe(database!, runtimeCoordinator!, {
            image: config.HIGHSTATE_RUNNER_BASE_IMAGE,
            agent: {
              binary: config.HIGHSTATE_RUNTIME_AGENT_BINARY,
              path: config.HIGHSTATE_RUNTIME_AGENT_PATH,
            },
          }).probe(runtimeId, signal),
      }),
    ),
  )
  const npmRegistries = new RuntimeProjectNpmRegistryProvider(database, {
    decrypt: async (_id, ciphertext) =>
      JSON.parse(await runtimeSecrets.decrypt(ciphertext)) as { token: string },
  })
  const snapshotImages = new SnapshotImageManager(
    database,
    runtimeAdapters,
    runtimeCoordinator,
    new DatabaseSnapshotImageConfiguration(
      database,
      runtimeSecrets,
      npmRegistries,
      config.HIGHSTATE_RUNNER_BASE_IMAGE,
    ),
  )
  const runtimeExecution = new RuntimeExecutionService(
    database,
    runtimeCoordinator,
    runtimeAdapters,
    snapshotImages,
    { binary: config.HIGHSTATE_RUNTIME_AGENT_BINARY, path: config.HIGHSTATE_RUNTIME_AGENT_PATH },
  )

  objectRefIndexService ??= new ObjectRefIndexService(
    database,
    logger.child({ service: "ObjectRefIndexService" }),
  )

  pubsubBackend ??= createPubSubBackend(config, logger)
  pubsubManager ??= new PubSubManager(pubsubBackend, logger)

  lockBackend ??= createLockBackend(config)
  lockManager ??= new LockManager(lockBackend)

  libraryBackend ??= await createLibraryBackend(config, logger)

  artifactBackend ??= await createArtifactBackend(config, database, logger)
  artifactService ??= new ArtifactService(database, artifactBackend, objectRefIndexService, logger)

  backendUnlockService ??= new BackendUnlockService(
    database,
    logger.child({ service: "BackendUnlockService" }),
  )

  backendRoleSettingsService ??= new BackendRoleSettingsService(database)

  backendServiceAccountSettingsService ??= new BackendServiceAccountSettingsService(
    database,
    projectUnlockBackend,
    backendRoleSettingsService,
  )

  backendApiKeySettingsService ??= new BackendApiKeySettingsService(
    database,
    backendRoleSettingsService,
    backendServiceAccountSettingsService,
  )

  projectRoleSettingsService ??= new ProjectRoleSettingsService(database)

  projectServiceAccountSettingsService ??= new ProjectServiceAccountSettingsService(
    database,
    projectRoleSettingsService,
  )

  projectApiKeySettingsService ??= new ProjectApiKeySettingsService(
    database,
    projectRoleSettingsService,
    projectServiceAccountSettingsService,
  )

  globalSearchService ??= new GlobalSearchService(
    database,
    projectUnlockBackend,
    logger.child({ service: "GlobalSearchService" }),
  )

  libraryService ??= new LibraryService(
    database,
    libraryBackend,
    projectUnlockBackend,
    logger.child({ service: "LibraryService" }),
    { catalog: projectId => projectLibraryService!.catalog(projectId) },
  )

  projectLibraryService ??= new ProjectLibraryService(
    new PrismaProjectLibraryStore(database),
    new NpmProjectLibraryResolver(npmRegistries, {
      runtimeProtocolVersion: 1,
      packageFormatVersion: 1,
      bunVersion: "1.3.13",
      pulumiVersion: "3.232.0",
    }),
    snapshotImages,
    new RuntimeProjectLibraryCatalogProvider(database, libraryBackend, libraryService),
    [{ packageName: "@highstate/library", version: "0.30.2" }],
    async projectId => {
      if (projectEvaluationSubsystem) await projectEvaluationSubsystem.evaluateProject(projectId)
    },
  )

  secretService ??= new SecretService(
    database,
    pubsubManager,
    libraryService,
    objectRefIndexService,
    logger.child({ service: "SecretService" }),
  )

  sessionService ??= new TerminalSessionService(database)
  runtimeArtifactTransfer ??= new RuntimeArtifactTransfer(artifactBackend, artifactService)

  runnerBackend ??= await createRunnerBackend(
    config,
    libraryBackend,
    artifactService,
    artifactBackend,
    secretService,
    logger,
    {
      database,
      execution: runtimeExecution,
      library: projectLibraryService,
      state: new DatabasePulumiActionConfiguration(database, secretService, ciphertext =>
        runtimeSecrets.decrypt(ciphertext),
      ),
      sidecars: new RuntimeSidecarManager(runtimeCoordinator, runtimeAdapters),
      artifacts: runtimeArtifactTransfer,
      legacy: new LazyRunnerBackend(
        async () =>
          await createRunnerBackend(
            { ...config!, HIGHSTATE_RUNNER_BACKEND_TYPE: "local" },
            libraryBackend!,
            artifactService!,
            artifactBackend!,
            secretService!,
            logger!,
          ),
      ),
    },
  )

  unitOutputService ??= new UnitOutputService(
    libraryBackend,
    logger.child({ service: "UnitOutputService" }),
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
    objectRefIndexService,
    config,
    logger.child({ service: "StateUnlockService" }),
  )

  projectUnlockService.registerUnlockTask("sync-object-refs", async projectId => {
    await objectRefIndexService.syncProject(projectId)
  })
  projectUnlockService.registerUnlockTask("initialize-project-library", async projectId => {
    try {
      await projectLibraryService!.onProjectUnlocked(projectId)
    } catch (error) {
      logger!.error({ error, projectId }, "failed to initialize project library")
    }
  })
  projectUnlockService.registerUnlockTask("collect-library-history", async projectId => {
    await new ProjectLibraryGarbageCollector(database!).collect(projectId)
  })

  operationService ??= new OperationService(
    database,
    pubsubManager,
    objectRefIndexService,
    logger.child({ service: "OperationService" }),
  )

  panelEndpointManager ??= new PanelEndpointManager(pubsubManager, workerProxyRegistry)
  panelService ??= new PanelService(database, pubsubManager, panelEndpointManager)

  entitySnapshotService ??= new EntitySnapshotService(
    database,
    objectRefIndexService,
    logger.child({ service: "EntitySnapshotService" }),
  )

  apiKeyService ??= new ApiKeyService(database, logger.child({ service: "ApiKeyService" }))

  terminalBackend ??= createTerminalBackend(runtimeCoordinator, runtimeAdapters, {
    readArtifact: async (projectId, file) => {
      if (file.content.type !== "artifact") throw new Error("Expected an artifact file")
      const project = await database!.forProject(projectId)
      const artifact = await project.artifact.findUniqueOrThrow({
        where: { hash: file.content.hash },
      })
      const content = await artifactBackend!.retrieve(projectId, artifact.hash, artifact.chunkSize)
      if (!content) throw new Error("Terminal artifact content is missing")
      const chunks: Uint8Array[] = []
      for await (const chunk of content) chunks.push(chunk)
      return Buffer.concat(chunks)
    },
  })
  terminalManager ??= TerminalManager.create(
    terminalBackend,
    database,
    pubsubManager,
    projectUnlockService,
    objectRefIndexService,
    logger,
  )

  workerBackend ??= createWorkerBackend(
    runtimeCoordinator,
    runtimeAdapters,
    database,
    pubsubManager,
    panelEndpointManager,
    {
      publicApiUrl: config.HIGHSTATE_PUBLIC_API_URL,
      onRunning: async (projectId, versionId, instanceId) => {
        await workerManager!.setWorkerRunning(projectId, versionId, instanceId)
      },
      onError: error => logger!.error({ error }, "worker runtime control failed"),
    },
  )
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
  operationSettingsService ??= new OperationSettingsService(database)
  terminalSettingsService ??= new TerminalSettingsService(database)
  pageSettingsService ??= new PageSettingsService(database)
  panelSettingsService ??= new PanelSettingsService(database, panelEndpointManager)
  secretSettingsService ??= new SecretSettingsService(database)
  triggerSettingsService ??= new TriggerSettingsService(database)
  artifactSettingsService ??= new ArtifactSettingsService(database)
  workerSettingsService ??= new WorkerSettingsService(database)
  entitySettingsService ??= new EntitySettingsService(database)
  unlockMethodSettingsService ??= new UnlockMethodSettingsService(database, projectUnlockService)

  instanceStateService ??= new InstanceStateService(
    database,
    pubsubManager,
    runnerBackend,
    workerService,
    artifactService,
    unitExtraService,
    secretService,
    objectRefIndexService,
    logger.child({ service: "InstanceService" }),
  )

  projectModelService ??= new ProjectModelService(
    database,
    libraryService,
    instanceStateService,
    projectModelBackends,
    projectUnlockService,
    logger.child({ service: "ProjectModelService" }),
  )

  projectEvaluationSubsystem ??= new ProjectEvaluationSubsystem(
    database,
    libraryBackend,
    libraryService,
    projectModelService,
    pubsubManager,
    projectUnlockService,
    objectRefIndexService,
    logger,
    new RuntimeEvaluationBackend(runtimeExecution),
    projectLibraryService,
  )

  projectService ??= new ProjectService(
    database,
    projectUnlockService,
    projectEvaluationSubsystem,
    projectModelService,
    projectModelBackends,
    libraryService,
    pubsubManager,
    objectRefIndexService,
    logger.child({ service: "ProjectService" }),
    projectLibraryService,
  )

  projectPortService ??= new ProjectPortService(
    database,
    pubsubManager,
    config.HIGHSTATE_ENCRYPTION_ENABLED,
    projectUnlockBackend,
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
    entitySnapshotService,
    unitOutputService,
    libraryService,
    projectPortService,
    database,
    logger,
    projectLibraryService,
  )

  runtimeMaintenance ??= new RuntimeMaintenance(database, runtimeCoordinator, logger)
  await runtimeMaintenance.reconcile()

  logger.info("services created")

  return {
    backendId,
    privateKey,
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
    runtimeCoordinator,
    runtimeCredentialSigner,
    workerProxyRegistry,
    runtimeArtifactTransfer,
    projectLibraryService,
    runtimeSettingsService,
    runtimeMaintenance,

    projectModelBackends,
    projectEvaluationSubsystem,

    operationManager,

    terminalBackend,
    terminalManager,

    workerBackend,
    workerManager,

    artifactBackend,
    artifactService,
    panelEndpointManager,

    // business services
    backendUnlockService,
    backendApiKeySettingsService,
    backendRoleSettingsService,
    backendServiceAccountSettingsService,
    projectApiKeySettingsService,
    projectRoleSettingsService,
    projectServiceAccountSettingsService,
    globalSearchService,
    instanceLockService,
    objectRefIndexService,
    projectUnlockService,
    operationService,
    panelService,
    instanceStateService,
    secretService,
    terminalSessionService: sessionService,
    apiKeyService,
    workerService,
    projectService,
    projectModelService,
    libraryService,
    projectPortService,
    operationSettingsService,
    terminalSettingsService,
    pageSettingsService,
    panelSettingsService,
    secretSettingsService,
    triggerSettingsService,
    artifactSettingsService,
    workerSettingsService,
    entitySettingsService,
    unlockMethodSettingsService,
    unitExtraService,
    entitySnapshotService,
    unitOutputService,
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
  await services.runtimeMaintenance?.[Symbol.asyncDispose]()
  const entries = Object.entries(services)
    .reverse()
    .filter(([key]) => key !== "database" && key !== "runtimeMaintenance")
  entries.push(["database", services.database])
  const disposed = new Set<object>()
  for (const [key, service] of entries) {
    if (typeof service !== "object" || service === null) {
      continue
    }
    if (disposed.has(service)) continue
    disposed.add(service)

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

      await disposeAsync()
    }
  }
}

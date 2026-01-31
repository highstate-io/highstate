/** biome-ignore-all lint/complexity/useLiteralKeys: не ори на меня */

import type { ConfigMap, OutputMap, Stack } from "@pulumi/pulumi/automation/index.js"
import type { Logger } from "pino"
import type { ArtifactBackend, ArtifactService } from "../artifact"
import type { LibraryBackend, ResolvedUnitSource } from "../library"
import type {
  OperationType,
  RunnerBackend,
  TypedUnitStateUpdate,
  UnitDestroyOptions,
  UnitOptions,
  UnitStateUpdate,
  UnitUpdateOptions,
} from "./abstractions"
import type { DualAbortSignal } from "./force-abort"
import { EventEmitter, on } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { crc32 } from "node:zlib"
import {
  getInstanceId,
  HighstateConfigKey,
  type InstanceId,
  instanceStatusFieldSchema,
  unitArtifactId,
  unitArtifactSchema,
  unitPageSchema,
  unitTerminalSchema,
  unitTriggerSchema,
  unitWorkerSchema,
} from "@highstate/contract"
import { encode } from "@msgpack/msgpack"
import { sha256 } from "@noble/hashes/sha2"
import { ensureDependencyInstalled } from "nypm"
import { mapValues, omitBy } from "remeda"
import { z } from "zod"
import { runWithRetryOnError } from "../common"
import {
  type ArtifactEnvironment,
  collectAndStoreArtifacts,
  setupArtifactEnvironment,
} from "./artifact-env"
import { type LocalPulumiHost, pulumiErrorToString, updateResourceCount } from "./pulumi"

type Events = {
  [K in `update:${string}`]: [UnitStateUpdate]
}

export const localRunnerBackendConfig = z.object({
  HIGHSTATE_RUNNER_BACKEND_LOCAL_PRINT_OUTPUT: z.coerce.boolean().default(true),
  HIGHSTATE_RUNNER_BACKEND_LOCAL_CACHE_DIR: z.string().optional(),
})

export class LocalRunnerBackend implements RunnerBackend {
  private readonly events = new EventEmitter<Events>()

  constructor(
    private readonly printOutput: boolean,
    private readonly cacheDir: string,
    private readonly pulumiProjectHost: LocalPulumiHost,
    private readonly libraryBackend: LibraryBackend,
    private readonly arttifactManager: ArtifactService,
    private readonly artifactBackend: ArtifactBackend,
    private readonly logger: Logger,
  ) {}

  async *watch(options: UnitOptions): AsyncIterable<UnitStateUpdate> {
    const stream = on(
      //
      this.events,
      `update:${LocalRunnerBackend.getInstanceId(options)}`,
      { signal: options.signal },
    ) as AsyncIterable<[UnitStateUpdate]>

    for await (const [update] of stream) {
      yield update

      if (update.type === "completion") {
        return
      }
    }
  }

  update(options: UnitUpdateOptions): Promise<void> {
    void this.updateWorker(options, false)

    return Promise.resolve()
  }

  preview(options: UnitUpdateOptions): Promise<void> {
    void this.updateWorker(options, true)

    return Promise.resolve()
  }

  private async updateWorker(options: UnitUpdateOptions, preview: boolean): Promise<void> {
    const configMap: ConfigMap = {
      [HighstateConfigKey.Config]: { value: JSON.stringify(options.config) },
      [HighstateConfigKey.Secrets]: { value: JSON.stringify(options.secrets), secret: true },
    }

    const unitId = LocalRunnerBackend.getInstanceId(options)
    const childLogger = this.logger.child({ unitId })

    // create a dedicated temp directory for this unit execution
    let unitTempPath: string | null = null
    let artifactEnv: ArtifactEnvironment | null = null

    try {
      // create unit-specific temp directory for better cleanup reliability
      unitTempPath = await mkdtemp(join(tmpdir(), `highstate-unit-${options.stateId}-`))
      childLogger.debug({ msg: "created unit temp directory", unitTempPath })
      options.signal?.throwIfAborted()

      artifactEnv = await setupArtifactEnvironment(
        options.projectId,
        options.artifacts ?? [],
        this.artifactBackend,
        unitTempPath,
        childLogger,
      )
      options.signal?.throwIfAborted()

      const resolvedSource = await this.getResolvedUnitSource(options)
      options.signal?.throwIfAborted()

      const envVars: Record<string, string> = {
        HIGHSTATE_CACHE_DIR: this.cacheDir,
        HIGHSTATE_TEMP_PATH: unitTempPath,
        PULUMI_K8S_DELETE_UNREACHABLE: options.deleteUnreachable ? "true" : "",
        ...options.envVars,
      }

      // enable terraform debug logging if debug mode is enabled
      if (options.debug) {
        envVars.TF_LOG = "DEBUG"
      }

      // add artifact paths if available
      if (artifactEnv.readPath) {
        envVars.HIGHSTATE_ARTIFACT_READ_PATH = artifactEnv.readPath
      }
      envVars.HIGHSTATE_ARTIFACT_WRITE_PATH = artifactEnv.writePath

      await this.pulumiProjectHost.runLocal(
        {
          projectId: options.projectId,
          pulumiProjectName: options.instanceType,
          pulumiStackName: LocalRunnerBackend.getStackName(options),
          projectPath: resolvedSource.projectPath,
          stackConfig: configMap,
          envVars,
        },
        async stack => {
          options.signal?.throwIfAborted()

          await stack.setAllConfig(configMap)
          options.signal?.throwIfAborted()

          let currentResourceCount = 0
          let totalResourceCount = 0

          const signal: DualAbortSignal | undefined = options.signal
          if (signal) {
            signal.forceSignal = options.forceSignal
          }

          await runWithRetryOnError(
            async () => {
              await stack[preview ? "preview" : "up"]({
                color: "always",
                refresh: options.refresh,
                signal,
                diff: preview,
                debug: options.debug,

                onEvent: event => {
                  if (event.resourcePreEvent) {
                    totalResourceCount = updateResourceCount(
                      event.resourcePreEvent.metadata.op,
                      totalResourceCount,
                    )

                    this.emitStateUpdate({ type: "progress", unitId, totalResourceCount })
                    return
                  }

                  if (event.resOutputsEvent) {
                    currentResourceCount = updateResourceCount(
                      event.resOutputsEvent.metadata.op,
                      currentResourceCount,
                    )

                    this.emitStateUpdate({ type: "progress", unitId, currentResourceCount })
                    return
                  }
                },

                onOutput: message => {
                  this.emitStateUpdate({ type: "message", unitId, message })

                  if (this.printOutput) {
                    console.log(message)
                  }
                },
              })

              const outputs = await stack.outputs()
              const completionUpdate = this.createCompletionStateUpdate("update", unitId, outputs)

              if (!preview && outputs["$artifacts"]) {
                const artifacts = z
                  .record(z.string(), unitArtifactSchema.array())
                  .parse(outputs["$artifacts"].value)

                await collectAndStoreArtifacts(
                  artifactEnv!.writePath,
                  options.projectId,
                  options.stateId,
                  this.arttifactManager,
                  Object.values(artifacts).flat(),
                  childLogger,
                )

                completionUpdate.exportedArtifactIds = mapValues(artifacts, artifacts => {
                  return artifacts.map(artifact => {
                    if (artifact[unitArtifactId]) {
                      return artifact[unitArtifactId]
                    }

                    throw new Error(
                      `Failed to determine artifact ID for artifact with hash ${artifact.hash}`,
                    )
                  })
                })
              } else if (preview && outputs["$artifacts"]) {
                childLogger.debug({ msg: "skipping artifact persistence for preview" })
              }

              this.emitStateUpdate(completionUpdate)
            },
            async error => {
              const isUnlocked = await this.pulumiProjectHost.tryUnlockStack(stack, error)
              if (isUnlocked) return true

              const isResolved = await this.tryInstallMissingDependencies(
                error,
                resolvedSource.allowedDependencies,
              )
              if (isResolved) return true

              return false
            },
          )
        },
      )
    } catch (error) {
      this.emitStateUpdate({
        unitId: unitId,
        type: "error",
        message: await pulumiErrorToString(error),
      })
    } finally {
      // clean up unit temp directory as a second layer of reliability
      await this.cleanupTempPath(unitTempPath, unitId, "update", this.logger)
    }
  }

  async destroy(options: UnitDestroyOptions): Promise<void> {
    void this.destroyWorker(options)

    return Promise.resolve()
  }

  async deleteState(options: UnitOptions): Promise<void> {
    await this.pulumiProjectHost.runEmpty(
      {
        projectId: options.projectId,
        pulumiProjectName: options.instanceType,
        pulumiStackName: LocalRunnerBackend.getStackName(options),
      },
      async stack => {
        const { StackNotFoundError } = await import("@pulumi/pulumi/automation/index.js")

        try {
          await stack.workspace.removeStack(stack.name, { force: true })
        } catch (error) {
          if (error instanceof StackNotFoundError) {
            return
          }
        }
      },
    )
  }

  private async destroyWorker(options: UnitDestroyOptions): Promise<void> {
    const unitId = LocalRunnerBackend.getInstanceId(options)

    try {
      const resolvedSource = await this.getResolvedUnitSource(options)
      if (!resolvedSource) {
        throw new Error(`Resolved unit source not found for ${options.instanceType}`)
      }

      options.signal?.throwIfAborted()

      await this.pulumiProjectHost.runLocal(
        {
          projectId: options.projectId,
          pulumiProjectName: options.instanceType,
          pulumiStackName: LocalRunnerBackend.getStackName(options),
          projectPath: resolvedSource.projectPath,
          envVars: {
            HIGHSTATE_CACHE_DIR: this.cacheDir,
            PULUMI_K8S_DELETE_UNREACHABLE: options.deleteUnreachable ? "true" : "",
            ...(options.debug && { TF_LOG: "DEBUG" }),
          },
        },
        async stack => {
          options.signal?.throwIfAborted()

          const summary = await stack.workspace.stack()
          let currentResourceCount = summary?.resourceCount ?? 0

          this.emitStateUpdate({
            unitId,
            type: "progress",
            currentResourceCount,
            totalResourceCount: currentResourceCount,
          })

          const signal: DualAbortSignal | undefined = options.signal
          if (signal) {
            signal.forceSignal = options.forceSignal
          }

          try {
            await runWithRetryOnError(
              async () => {
                await stack.destroy({
                  color: "always",
                  refresh: options.refresh,
                  remove: true,
                  signal,
                  debug: options.debug,

                  onEvent: event => {
                    if (event.resOutputsEvent) {
                      currentResourceCount = updateResourceCount(
                        event.resOutputsEvent.metadata.op,
                        currentResourceCount,
                      )

                      this.emitStateUpdate({ type: "progress", unitId, currentResourceCount })
                      return
                    }
                  },

                  onOutput: message => {
                    this.emitStateUpdate({ type: "message", unitId, message })

                    if (this.printOutput) {
                      console.log(message)
                    }
                  },
                })

                await this.emitCompletionStateUpdate("destroy", unitId, stack)
              },
              error => this.pulumiProjectHost.tryUnlockStack(stack, error),
            )
          } catch (error) {
            if (options.forceDeleteState) {
              await stack.workspace.removeStack(stack.name, { force: true })
            } else {
              throw error
            }
          }
        },
      )
    } catch (error) {
      const { StackNotFoundError } = await import("@pulumi/pulumi/automation/index.js")

      if (error instanceof StackNotFoundError) {
        this.emitStateUpdate({
          type: "completion",
          operationType: "destroy",
          unitId,
          outputHash: null,
          message: null,
        })
        return
      }

      this.emitStateUpdate({
        type: "error",
        unitId: unitId,
        message: await pulumiErrorToString(error),
      })
    }
  }

  refresh(options: UnitOptions): Promise<void> {
    void this.refreshWorker(options)

    return Promise.resolve()
  }

  private async refreshWorker(options: UnitOptions): Promise<void> {
    const unitId = LocalRunnerBackend.getInstanceId(options)

    try {
      await this.pulumiProjectHost.runEmpty(
        {
          projectId: options.projectId,
          pulumiProjectName: options.instanceType,
          pulumiStackName: LocalRunnerBackend.getStackName(options),
        },
        async stack => {
          options.signal?.throwIfAborted()

          const summary = await stack.workspace.stack()
          options.signal?.throwIfAborted()

          let currentResourceCount = 0
          let totalResourceCount = summary?.resourceCount ?? 0

          this.emitStateUpdate({
            type: "progress",
            unitId,

            currentResourceCount,
            totalResourceCount,
          })

          await runWithRetryOnError(
            async () => {
              await stack.refresh({
                color: "always",
                debug: options.debug,

                onEvent: event => {
                  if (event.resourcePreEvent) {
                    totalResourceCount = updateResourceCount(
                      event.resourcePreEvent.metadata.op,
                      totalResourceCount,
                    )

                    if (totalResourceCount > currentResourceCount) {
                      this.emitStateUpdate({ type: "progress", unitId, totalResourceCount })
                    }
                    return
                  }

                  if (event.resOutputsEvent) {
                    currentResourceCount = updateResourceCount(
                      event.resOutputsEvent.metadata.op,
                      currentResourceCount,
                    )

                    this.emitStateUpdate({ type: "progress", unitId, currentResourceCount })
                    return
                  }
                },
                onOutput: message => {
                  this.emitStateUpdate({ type: "message", unitId, message })

                  if (this.printOutput) {
                    console.log(message)
                  }
                },
                signal: options.signal,
              })

              this.emitStateUpdate({
                type: "completion",
                operationType: "refresh",
                unitId,

                // do not emit output-related fields on refresh since they will not change
                // some of them (like artifact files) are not even available on refresh
              })
            },
            error => this.pulumiProjectHost.tryUnlockStack(stack, error),
          )
        },
      )
    } catch (error) {
      this.emitStateUpdate({
        type: "error",
        unitId,
        message: await pulumiErrorToString(error),
      })
    }
  }

  private createCompletionStateUpdate(
    opType: "update" | "destroy" | "refresh",
    unitId: InstanceId,
    outputs: OutputMap,
  ): TypedUnitStateUpdate<"completion"> {
    const unitOutputs = omitBy(outputs, (_, key) => key.startsWith("$"))

    return {
      unitId,
      type: "completion",
      operationType: opType,

      outputHash: crc32(sha256(encode(unitOutputs))),

      statusFields: outputs["$statusFields"]
        ? z.array(instanceStatusFieldSchema).parse(outputs["$statusFields"].value)
        : null,

      terminals: outputs["$terminals"]
        ? z.array(unitTerminalSchema).parse(outputs["$terminals"].value)
        : null,

      pages: outputs["$pages"] ? z.array(unitPageSchema).parse(outputs["$pages"].value) : null,

      triggers: outputs["$triggers"]
        ? z.array(unitTriggerSchema).parse(outputs["$triggers"].value)
        : null,

      workers: outputs["$workers"]
        ? z.array(unitWorkerSchema).parse(outputs["$workers"].value)
        : null,

      secrets: outputs["$secrets"]
        ? z.record(z.string(), z.unknown()).parse(outputs["$secrets"].value)
        : null,
    }
  }

  private async emitCompletionStateUpdate(
    opType: OperationType,
    unitId: InstanceId,
    stack: Stack,
  ): Promise<TypedUnitStateUpdate<"completion">> {
    const output = await stack.outputs()
    const update = this.createCompletionStateUpdate(opType, unitId, output)

    return this.emitStateUpdate(update)
  }

  private emitStateUpdate<TUpdate extends UnitStateUpdate>(update: TUpdate): TUpdate {
    this.events.emit(`update:${update.unitId}`, update)

    return update
  }

  private async cleanupTempPath(
    tempPath: string | null,
    instanceId: string,
    operation: string,
    logger: Logger,
  ): Promise<void> {
    if (!tempPath) {
      return
    }

    try {
      await rm(tempPath, { recursive: true, force: true })
      logger.debug({
        msg: `cleaned up unit temp directory for ${operation}`,
        tempPath,
        instanceId,
      })
    } catch (error) {
      logger.warn({
        msg: `failed to cleanup unit temp directory for ${operation}`,
        tempPath,
        instanceId,
        error,
      })
    }
  }

  private static getInstanceId(options: UnitOptions) {
    return getInstanceId(options.instanceType, options.instanceName)
  }

  private async tryInstallMissingDependencies(
    error: unknown,
    allowedDependencies: string[],
  ): Promise<boolean> {
    if (!(error instanceof Error)) {
      return false
    }

    const pattern = /Cannot find module '(.*)'/
    const match = error.message.match(pattern)

    if (!match) {
      return false
    }

    const packageName = match[1]

    if (!allowedDependencies.includes(packageName)) {
      throw new Error(
        `Dependency '${packageName}' was requested to be auto-installed, but it is not allowed. Please add it to the 'peerDependencies' in the package.json of the unit.`,
      )
    }

    await ensureDependencyInstalled(packageName)
    return true
  }

  private async getResolvedUnitSource(options: UnitOptions): Promise<ResolvedUnitSource> {
    const sources = await this.libraryBackend.getResolvedUnitSources(options.libraryId, [
      options.instanceType,
    ])
    const source = sources.find(source => source.unitType === options.instanceType)

    if (!source) {
      throw new Error(`Resolved unit source not found for ${options.instanceType}`)
    }

    return source
  }

  private static getStackName(options: UnitOptions) {
    return options.stateId
  }

  public static create(
    config: z.infer<typeof localRunnerBackendConfig>,
    pulumiProjectHost: LocalPulumiHost,
    libraryBackend: LibraryBackend,
    artifactManager: ArtifactService,
    artifactBackend: ArtifactBackend,
    logger: Logger,
  ): RunnerBackend {
    let cacheDir = config.HIGHSTATE_RUNNER_BACKEND_LOCAL_CACHE_DIR
    if (!cacheDir) {
      const homeDir = process.env.HOME ?? process.env.USERPROFILE
      if (!homeDir) {
        throw new Error(
          "Failed to determine the home directory, please set HIGHSTATE_BACKEND_RUNNER_LOCAL_CACHE_DIR",
        )
      }

      cacheDir = resolve(homeDir, ".cache", "highstate")
    }

    return new LocalRunnerBackend(
      config.HIGHSTATE_RUNNER_BACKEND_LOCAL_PRINT_OUTPUT,
      cacheDir,
      pulumiProjectHost,
      libraryBackend,
      artifactManager,
      artifactBackend,
      logger,
    )
  }
}

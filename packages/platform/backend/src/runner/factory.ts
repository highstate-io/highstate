import type { Logger } from "pino"
import type { ArtifactBackend, ArtifactService } from "../artifact"
import type { SecretService } from "../business"
import type { ProjectLibraryService } from "../business/project-library"
import type { DatabaseManager } from "../database"
import type { LibraryBackend } from "../library"
import type { RunnerBackend } from "./abstractions"
import type { RuntimeArtifactTransfer } from "./runtime-artifacts"
import type { RuntimeExecutionService } from "./runtime-execution"
import type { RuntimeSidecarManager } from "./runtime-sidecars"
import { z } from "zod"
import { LocalRunnerBackend, localRunnerBackendConfig } from "./local"
import { LocalPulumiHost } from "./pulumi"
import { type PulumiActionConfiguration, RuntimeRunnerBackend } from "./runtime"

export type RuntimeRunnerDependencies = {
  database: DatabaseManager
  execution: RuntimeExecutionService
  library: ProjectLibraryService
  state: PulumiActionConfiguration
  sidecars: RuntimeSidecarManager
  artifacts: RuntimeArtifactTransfer
  legacy?: RunnerBackend
}

export const runnerBackendConfig = z.object({
  HIGHSTATE_RUNNER_BACKEND_TYPE: z.enum(["local", "runtime"]).default("runtime"),
  HIGHSTATE_RUNTIME_AGENT_BINARY: z.string().default("bun"),
  HIGHSTATE_RUNTIME_AGENT_PATH: z.string().default("/opt/highstate/runtime-agent/main.js"),
  HIGHSTATE_RUNNER_BASE_IMAGE: z.string().optional(),
  ...localRunnerBackendConfig.shape,
})

export async function createRunnerBackend(
  config: z.infer<typeof runnerBackendConfig>,
  libraryBackend: LibraryBackend,
  artifactManager: ArtifactService,
  artifactBackend: ArtifactBackend,
  secretService: SecretService,
  logger: Logger,
  runtime?: RuntimeRunnerDependencies,
): Promise<RunnerBackend> {
  if (config.HIGHSTATE_RUNNER_BACKEND_TYPE === "runtime") {
    if (!runtime) throw new Error("Runtime runner dependencies are required")
    // retain the old executable environment only for null-provenance and local callers
    const legacy =
      runtime.legacy ??
      (await LocalRunnerBackend.create(
        config,
        LocalPulumiHost.create(secretService, logger),
        libraryBackend,
        artifactManager,
        artifactBackend,
        logger,
      ))
    return new RuntimeRunnerBackend(
      runtime.database,
      runtime.execution,
      runtime.library,
      runtime.state,
      runtime.sidecars,
      legacy,
      runtime.artifacts,
    )
  }
  switch (config.HIGHSTATE_RUNNER_BACKEND_TYPE) {
    case "local": {
      const localPulumiHost = LocalPulumiHost.create(
        secretService,
        logger,
        config.HIGHSTATE_RUNNER_BACKEND_LOCAL_UNSHARE_FORWARD_SIGNALS,
      )

      return await LocalRunnerBackend.create(
        config,
        localPulumiHost,
        libraryBackend,
        artifactManager,
        artifactBackend,
        logger,
      )
    }
  }
}

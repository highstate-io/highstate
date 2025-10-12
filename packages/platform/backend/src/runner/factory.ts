import type { Logger } from "pino"
import type { ArtifactBackend, ArtifactService } from "../artifact"
import type { SecretService } from "../business"
import type { LibraryBackend } from "../library"
import type { RunnerBackend } from "./abstractions"
import { z } from "zod"
import { LocalRunnerBackend, localRunnerBackendConfig } from "./local"
import { LocalPulumiHost } from "./pulumi"

export const runnerBackendConfig = z.object({
  HIGHSTATE_RUNNER_BACKEND_TYPE: z.enum(["local"]).default("local"),
  ...localRunnerBackendConfig.shape,
})

export function createRunnerBackend(
  config: z.infer<typeof runnerBackendConfig>,
  libraryBackend: LibraryBackend,
  artifactManager: ArtifactService,
  artifactBackend: ArtifactBackend,
  secretService: SecretService,
  logger: Logger,
): RunnerBackend {
  switch (config.HIGHSTATE_RUNNER_BACKEND_TYPE) {
    case "local": {
      const localPulumiHost = LocalPulumiHost.create(secretService, logger)

      return LocalRunnerBackend.create(
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

import type { Logger } from "pino"
import type { WorkerBackend } from "./abstractions"
import { z } from "zod"
import { DockerWorkerBackend, dockerWorkerBackendConfig } from "./docker"

export const workerBackendConfig = z.object({
  HIGHSTATE_WORKER_BACKEND_TYPE: z.enum(["docker"]).default("docker"),
  ...dockerWorkerBackendConfig.shape,
})

export function createWorkerBackend(
  config: z.infer<typeof workerBackendConfig>,
  logger: Logger,
): WorkerBackend {
  switch (config.HIGHSTATE_WORKER_BACKEND_TYPE) {
    case "docker": {
      return DockerWorkerBackend.create(config, logger)
    }
  }
}

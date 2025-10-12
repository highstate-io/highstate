import type { Logger } from "pino"
import type { TerminalBackend } from "./abstractions"
import { z } from "zod"
import { DockerTerminalBackend, dockerTerminalBackendConfig } from "./docker"

export const terminalBackendConfig = z.object({
  HIGHSTATE_TERMINAL_BACKEND_TYPE: z.enum(["docker"]).default("docker"),
  ...dockerTerminalBackendConfig.shape,
})

export function createTerminalBackend(
  config: z.infer<typeof terminalBackendConfig>,
  logger: Logger,
): TerminalBackend {
  switch (config.HIGHSTATE_TERMINAL_BACKEND_TYPE) {
    case "docker": {
      return DockerTerminalBackend.create(config, logger)
    }
  }
}

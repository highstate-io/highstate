import type { Logger } from "pino"
import type { PubSubBackend } from "./abstractions"
import { z } from "zod"
import { MemoryPubSubBackend } from "./memory"

export const pubSubBackendConfig = z.object({
  HIGHSTATE_PUBSUB_BACKEND_TYPE: z.enum(["memory"]).default("memory"),
})

export function createPubSubBackend(
  config: z.infer<typeof pubSubBackendConfig>,
  logger: Logger,
): PubSubBackend {
  switch (config.HIGHSTATE_PUBSUB_BACKEND_TYPE) {
    case "memory": {
      return new MemoryPubSubBackend(logger)
    }
  }
}

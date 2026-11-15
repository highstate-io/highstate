import type { RuntimeAdapterProvider, RuntimeCoordinator } from "../container-runtime"
import type { DatabaseManager } from "../database"
import type { PanelEndpointManager } from "../panel"
import type { PubSubManager } from "../pubsub"
import type { WorkerBackend } from "./abstractions"
import { z } from "zod"
import { RuntimeWorkerBackend, type RuntimeWorkerOptions } from "./runtime"

export const workerBackendConfig = z.object({})

export function createWorkerBackend(
  coordinator: RuntimeCoordinator,
  adapters: RuntimeAdapterProvider,
  database: DatabaseManager,
  pubsub: PubSubManager,
  panels: PanelEndpointManager,
  options: RuntimeWorkerOptions,
): WorkerBackend {
  return new RuntimeWorkerBackend(coordinator, adapters, database, pubsub, panels, options)
}

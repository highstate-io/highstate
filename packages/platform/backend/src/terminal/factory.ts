import type { RuntimeAdapterProvider, RuntimeCoordinator } from "../container-runtime"
import type { TerminalBackend } from "./abstractions"
import { z } from "zod"
import { RuntimeTerminalBackend, type RuntimeTerminalOptions } from "./runtime"

export const terminalBackendConfig = z.object({})

export function createTerminalBackend(
  coordinator: RuntimeCoordinator,
  adapters: RuntimeAdapterProvider,
  options?: RuntimeTerminalOptions,
): TerminalBackend {
  return new RuntimeTerminalBackend(coordinator, adapters, options)
}

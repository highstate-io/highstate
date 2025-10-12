import type { Logger } from "pino"
import type { LibraryBackend } from "./abstractions"
import { z } from "zod"
import { LocalLibraryBackend, localLibraryBackendConfig } from "./local"

export const libraryBackendConfig = z.object({
  HIGHSTATE_LIBRARY_BACKEND_TYPE: z.enum(["local"]).default("local"),
  ...localLibraryBackendConfig.shape,
})

export async function createLibraryBackend(
  config: z.infer<typeof libraryBackendConfig>,
  logger: Logger,
): Promise<LibraryBackend> {
  switch (config.HIGHSTATE_LIBRARY_BACKEND_TYPE) {
    case "local": {
      return await LocalLibraryBackend.create(config, logger)
    }
  }
}

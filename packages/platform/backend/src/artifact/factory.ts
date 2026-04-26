import type { Logger } from "pino"
import type { DatabaseManager } from "../database"
import type { ArtifactBackend } from "./abstractions"
import { z } from "zod"
import { EncryptionArtifactBackend } from "./encryption"
import { LocalArtifactBackend, localArtifactBackendConfig } from "./local"

export const artifactBackendConfig = z.object({
  HIGHSTATE_ARTIFACT_BACKEND_TYPE: z.enum(["local"]).default("local"),
  HIGHSTATE_ENCRYPTION_ENABLED: z.stringbool().default(true),
  ...localArtifactBackendConfig.shape,
})

export async function createArtifactBackend(
  config: z.infer<typeof artifactBackendConfig>,
  database: DatabaseManager,
  logger: Logger,
): Promise<ArtifactBackend> {
  let backend: ArtifactBackend

  const fileExtension = config.HIGHSTATE_ENCRYPTION_ENABLED ? ".tgz.enc" : ".tgz"

  switch (config.HIGHSTATE_ARTIFACT_BACKEND_TYPE) {
    case "local": {
      backend = await LocalArtifactBackend.create(config, fileExtension, logger)
    }
  }

  if (database.isEncryptionEnabled) {
    backend = new EncryptionArtifactBackend(backend, database)
  }

  return backend
}

import type { SecretService } from "../business/secret"
import type { DatabaseManager } from "../database"
import type { PulumiActionConfiguration } from "./runtime"
import { z } from "zod"

export class DatabasePulumiActionConfiguration implements PulumiActionConfiguration {
  constructor(
    private readonly database: DatabaseManager,
    private readonly secrets: SecretService,
    private readonly decrypt: (ciphertext: string) => Promise<string>,
  ) {}

  async get(projectId: string) {
    const project = await this.database.backend.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { pulumiStateBackend: true },
    })

    const spec = project.pulumiStateBackend.spec

    const credentials = spec.encryptedCredentials
      ? z
          .record(z.string(), z.string())
          .parse(JSON.parse(await this.decrypt(spec.encryptedCredentials)))
      : {}

    return {
      url: spec.url.startsWith("file:") ? "file:///var/lib/highstate/pulumi" : spec.url,
      environment: {
        ...credentials,
        PULUMI_CONFIG_PASSPHRASE: await this.secrets.getPulumiPassword(projectId),
      },
    }
  }
}

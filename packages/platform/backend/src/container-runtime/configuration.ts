import type { DatabaseManager } from "../database"
import type { ProjectNpmRegistryProvider } from "../library"
import type { RegistryCredential } from "./contracts"
import type { RuntimeSecretResolver } from "./factory"
import type { SnapshotImageBuildConfig, SnapshotImageConfiguration } from "./snapshot-images"
import { armor, Decrypter } from "age-encryption"

/** Decrypts backend-owned credentials only at their runtime boundary. */
export class BackendRuntimeSecrets implements RuntimeSecretResolver {
  constructor(
    private readonly database: DatabaseManager,
    private readonly privateKey: string,
  ) {}

  async decrypt(ciphertext: string): Promise<string> {
    const decrypter = new Decrypter()
    decrypter.addIdentity(this.privateKey)
    return await decrypter.decrypt(armor.decode(ciphertext), "text")
  }

  async registryCredentials(runtimeId: string): Promise<RegistryCredential[]> {
    const runtime = await this.database.backend.containerRuntime.findUniqueOrThrow({
      where: { id: runtimeId },
      include: { containerRegistryCredentials: true },
    })
    return await Promise.all(
      runtime.containerRegistryCredentials.map(async credential => {
        const value = JSON.parse(await this.decrypt(credential.encryptedCredentials)) as {
          username: string
          password: string
        }
        return { serveraddress: credential.registryUrl, ...value }
      }),
    )
  }
}

/** Supplies runtime-scoped registry credentials as ephemeral build secrets. */
export class DatabaseSnapshotImageConfiguration implements SnapshotImageConfiguration {
  constructor(
    private readonly database: DatabaseManager,
    private readonly secrets: RuntimeSecretResolver,
    private readonly npm: ProjectNpmRegistryProvider,
    private readonly baseImage?: string,
  ) {}

  async get(projectId: string, runtimeId: string): Promise<SnapshotImageBuildConfig> {
    if (!this.baseImage)
      throw new Error("HIGHSTATE_RUNNER_BASE_IMAGE must name a digest-pinned runner image")
    const runtime = await this.database.backend.containerRuntime.findUniqueOrThrow({
      where: { id: runtimeId },
    })
    const lines: string[] = []
    for (const [scope, access] of Object.entries((await this.npm.scopes?.(projectId)) ?? {})) {
      const url = new URL(access.registryUrl)
      lines.push(`${scope ? `${scope}:` : ""}registry=${url.href}`)
      if (access.token)
        lines.push(`//${url.host}${url.pathname.replace(/\/?$/, "/")}:_authToken=${access.token}`)
    }
    return {
      baseImage: this.baseImage,
      repository: runtime.spec.imageRepository,
      npmrc: lines.length ? Buffer.from(`${lines.join("\n")}\n`) : undefined,
      registryCredentials: await this.secrets.registryCredentials(runtimeId),
    }
  }
}

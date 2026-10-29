import type { DatabaseManager } from "../database"
import type { ContainerRuntimeSpec } from "../shared"
import type {
  ContainerRuntimeAdapter,
  RegistryCredential,
  RuntimeAdapterProvider,
} from "./contracts"
import { DockerRuntimeAdapter, type DockerRuntimeConfig } from "./docker"
import { KubernetesRuntimeAdapter, type KubernetesRuntimeConfig } from "./kubernetes"

export type ContainerRuntimeFactoryConfig =
  | ({ type: "docker" } & DockerRuntimeConfig)
  | ({ type: "kubernetes" } & KubernetesRuntimeConfig)

export function createContainerRuntimeAdapter(
  config: ContainerRuntimeFactoryConfig,
): ContainerRuntimeAdapter {
  return config.type === "docker"
    ? new DockerRuntimeAdapter(config)
    : new KubernetesRuntimeAdapter(config)
}

export interface RuntimeSecretResolver {
  decrypt(ciphertext: string): Promise<string>
  registryCredentials(runtimeId: string): Promise<RegistryCredential[]>
}

/**
 * Shared by placement and the settings preflight bridge, including unsaved settings.
 */
export async function resolveRuntimeAdapterConfig(
  spec: ContainerRuntimeSpec,
  secrets: RuntimeSecretResolver,
  runtimeId: string,
): Promise<ContainerRuntimeFactoryConfig> {
  if (spec.type === "docker") {
    return {
      type: "docker",
      endpoint: spec.engineEndpoint,
      local: spec.local,
      registryCredentials: await secrets.registryCredentials(runtimeId),
      tls: spec.tls
        ? {
            ca: spec.tls.encryptedCaBundle
              ? await secrets.decrypt(spec.tls.encryptedCaBundle)
              : undefined,
            cert: spec.tls.encryptedClientCertificate
              ? await secrets.decrypt(spec.tls.encryptedClientCertificate)
              : undefined,
            key: spec.tls.encryptedClientKey
              ? await secrets.decrypt(spec.tls.encryptedClientKey)
              : undefined,
          }
        : undefined,
    }
  }

  return {
    type: "kubernetes",
    namespace: spec.namespace,
    serviceAccount: spec.serviceAccount,
    context: spec.context,
    buildkitImage: spec.buildkitImage,
    kubeconfig: spec.encryptedKubeconfig
      ? await secrets.decrypt(spec.encryptedKubeconfig)
      : undefined,
    registryCredentials: await secrets.registryCredentials(runtimeId),
  }
}

export class DatabaseRuntimeAdapterProvider implements RuntimeAdapterProvider {
  private readonly adapters = new Map<
    string,
    { revision: number; adapter: ContainerRuntimeAdapter }
  >()

  constructor(
    private readonly database: DatabaseManager,
    private readonly secrets: RuntimeSecretResolver,
  ) {}

  async get(runtimeId: string): Promise<ContainerRuntimeAdapter> {
    const runtime = await this.database.backend.containerRuntime.findUniqueOrThrow({
      where: { id: runtimeId },
    })

    const current = this.adapters.get(runtimeId)
    if (current?.revision === runtime.revision) {
      return current.adapter
    }

    const config = await resolveRuntimeAdapterConfig(runtime.spec, this.secrets, runtimeId)
    const adapter = createContainerRuntimeAdapter(config)
    this.adapters.set(runtimeId, { revision: runtime.revision, adapter })
    return adapter
  }

  invalidate(runtimeId: string): void {
    this.adapters.delete(runtimeId)
  }
}

import type { DatabaseManager } from "../database"
import type { ContainerRuntimeSpec } from "../shared"
import type { PreflightCheck } from "./contracts"
import {
  createContainerRuntimeAdapter,
  type RuntimeSecretResolver,
  resolveRuntimeAdapterConfig,
} from "./factory"

export interface RuntimePreflightOptions {
  registryImage?: string
  /**
   * Optional real authenticated agent probe, supplied by the runtime transport composition.
   */
  probe?: (signal?: AbortSignal) => Promise<void>
  signal?: AbortSignal
}

export class RuntimeSettingsPreflightBridge {
  constructor(private readonly secrets: RuntimeSecretResolver) {}

  async preflight(
    runtimeId: string,
    spec: ContainerRuntimeSpec,
    options: RuntimePreflightOptions = {},
  ): Promise<PreflightCheck[]> {
    const checks: PreflightCheck[] = []

    const check = async (name: string, operation: () => Promise<void>) => {
      try {
        await operation()
        checks.push({ name, ok: true })
      } catch (error) {
        options.signal?.throwIfAborted()
        checks.push({ name, ok: false, detail: String(error) })
      }
    }

    const adapter = createContainerRuntimeAdapter(
      await resolveRuntimeAdapterConfig(spec, this.secrets, runtimeId),
    )

    await check("connectivity", async () => {
      checks.push(...(await adapter.preflight(options.signal)))
    })

    await check("runtime-api-url", async () => {
      if (new URL(spec.runtimeApiUrl).protocol !== "https:") {
        throw new Error("Workload runtime API URL must use TLS")
      }
    })

    if (spec.type === "kubernetes" || (spec.type === "docker" && !spec.local)) {
      await check("image-repository", async () => {
        if (!spec.imageRepository) {
          throw new Error("Remote runtimes require an image repository")
        }
      })
    }

    if (options.registryImage) {
      await check("registry", async () => {
        await adapter.ensureImage(
          options.registryImage!,
          await this.secrets.registryCredentials(runtimeId),
          options.signal,
        )
      })
    }

    if (options.probe) {
      await check("authenticated-agent-stream", async () => {
        await options.probe!(options.signal)
      })
    }

    return checks
  }
}

/**
 * Structurally implements the settings service's injectable preflight provider.
 */
export class RuntimePreflightProviderBridge {
  constructor(
    private readonly database: DatabaseManager,
    private readonly bridge: RuntimeSettingsPreflightBridge,
    private readonly options: (
      runtimeId: string,
    ) => Promise<RuntimePreflightOptions> = async () => ({}),
  ) {}

  async get(
    runtimeId: string,
  ): Promise<{ preflight(signal?: AbortSignal): Promise<PreflightCheck[]> }> {
    const runtime = await this.database.backend.containerRuntime.findUniqueOrThrow({
      where: { id: runtimeId },
    })

    return {
      preflight: async signal =>
        await this.bridge.preflight(runtimeId, runtime.spec, {
          ...(await this.options(runtimeId)),
          signal,
        }),
    }
  }
}

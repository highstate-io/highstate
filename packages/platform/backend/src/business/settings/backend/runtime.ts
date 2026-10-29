import type { BackendRequestContext } from "../../../common"
import type {
  BackendTransaction,
  ContainerRuntime,
  DatabaseManager,
  PulumiStateBackend,
} from "../../../database"
import type { ContainerRuntimeSpec } from "../../../shared/models/backend/runtime"
import { armor, Encrypter, identityToRecipient } from "age-encryption"
import { buildBackendAuthorizationWhere, requireBackendPermission } from "../../../common"
import {
  type ContainerRuntimeInputSpec,
  containerRegistryCredentialInputSchema,
  containerRegistryCredentialOutputSchema,
  containerRuntimeInputSchema,
  containerRuntimeOutputSchema,
  npmRegistryCredentialInputSchema,
  npmRegistryCredentialOutputSchema,
  pulumiStateBackendInputSchema,
  pulumiStateBackendOutputSchema,
  RuntimeSettingsConflictError,
  type RuntimeSettingsInputs,
  RuntimeSettingsInUseError,
  type RuntimeSettingsKind,
  type RuntimeSettingsOutputs,
  runtimeSettingsKindSchema,
} from "../../../shared/models/backend/runtime-settings"

export type RuntimePreflightCheck = { name: string; ok: boolean; detail?: string }

export interface RuntimeSettingsPreflightAdapter {
  preflight(signal?: AbortSignal): Promise<RuntimePreflightCheck[]>
}

export interface RuntimeSettingsPreflightProvider {
  get(runtimeId: string): Promise<RuntimeSettingsPreflightAdapter>
}

type Output = RuntimeSettingsOutputs[RuntimeSettingsKind]
const runtimeInclude = {
  npmRegistryCredentials: { select: { id: true } },
  containerRegistryCredentials: { select: { id: true } },
} as const

export class RuntimeSettingsService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly privateKey: string,
    private readonly preflightProvider?: RuntimeSettingsPreflightProvider,
  ) {}

  /**
   * Lists settings visible to the caller, without returning secret material.
   */
  async list<K extends RuntimeSettingsKind>(
    context: BackendRequestContext,
    kind: K,
  ): Promise<RuntimeSettingsOutputs[K][]>
  async list(context: BackendRequestContext, kind: RuntimeSettingsKind): Promise<Output[]> {
    runtimeSettingsKindSchema.parse(kind)

    const where = await buildBackendAuthorizationWhere({
      database: this.database,
      context,
      permission: `${kind}.list`,
      target: { resources: ids => ({ id: { in: [...ids] } }) },
    })

    const db = this.database.backend

    switch (kind) {
      case "container-runtime":
        return (
          await db.containerRuntime.findMany({
            where,
            include: runtimeInclude,
            orderBy: { id: "asc" },
          })
        ).map(runtimeOutput)
      case "pulumi-state-backend":
        return (await db.pulumiStateBackend.findMany({ where, orderBy: { id: "asc" } })).map(
          stateOutput,
        )
      case "npm-registry-credential":
        return (await db.npmRegistryCredential.findMany({ where, orderBy: { id: "asc" } })).map(
          row =>
            npmRegistryCredentialOutputSchema.parse({
              ...row,
              credentialsConfigured: !!row.encryptedCredentials,
            }),
        )
      case "container-registry-credential":
        return (
          await db.containerRegistryCredential.findMany({ where, orderBy: { id: "asc" } })
        ).map(row =>
          containerRegistryCredentialOutputSchema.parse({
            ...row,
            credentialsConfigured: !!row.encryptedCredentials,
          }),
        )
    }
  }

  /**
   * Creates at revision zero, or replaces the matching revision and increments it atomically.
   * Omitted secrets preserve stored ciphertext; explicit null clears optional secrets.
   */
  async put<K extends RuntimeSettingsKind>(
    context: BackendRequestContext,
    kind: K,
    id: string,
    input: RuntimeSettingsInputs[K],
  ): Promise<RuntimeSettingsOutputs[K]>
  async put(
    context: BackendRequestContext,
    kind: RuntimeSettingsKind,
    id: string,
    input: RuntimeSettingsInputs[RuntimeSettingsKind],
  ): Promise<Output> {
    runtimeSettingsKindSchema.parse(kind)
    requireBackendPermission(context, `${kind}.manage`, { resourceId: id })

    if (!id) {
      throw new Error("Settings ID must not be empty")
    }

    try {
      return await this.database.backend.$transaction(async tx => {
        switch (kind) {
          case "container-runtime": {
            const data = containerRuntimeInputSchema.parse(input)

            for (const credentialId of data.npmRegistryCredentialIds) {
              requireBackendPermission(context, "npm-registry-credential.get", {
                resourceId: credentialId,
              })
            }

            for (const credentialId of data.containerRegistryCredentialIds) {
              requireBackendPermission(context, "container-registry-credential.get", {
                resourceId: credentialId,
              })
            }

            const current = await tx.containerRuntime.findUnique({ where: { id } })
            assertRevision(kind, id, data.revision, current)
            const spec = await this.runtimeSpec(data.spec, current?.spec)
            const values = { meta: data.meta, spec }

            if (current) {
              const result = await tx.containerRuntime.updateMany({
                where: { id, revision: data.revision },
                data: { ...values, revision: { increment: 1 } },
              })

              assertChanged(kind, id, result.count)
            } else {
              await tx.containerRuntime.create({ data: { id, ...values } })
            }

            const row = await tx.containerRuntime.update({
              where: { id },
              data: {
                npmRegistryCredentials: { set: data.npmRegistryCredentialIds.map(id => ({ id })) },
                containerRegistryCredentials: {
                  set: data.containerRegistryCredentialIds.map(id => ({ id })),
                },
              },
              include: runtimeInclude,
            })

            return runtimeOutput(row)
          }
          case "pulumi-state-backend": {
            const data = pulumiStateBackendInputSchema.parse(input)
            const current = await tx.pulumiStateBackend.findUnique({ where: { id } })
            assertRevision(kind, id, data.revision, current)

            const encryptedCredentials = await this.secret(
              data.spec.credentials,
              current?.spec.encryptedCredentials,
            )

            const values = {
              meta: data.meta,
              spec: {
                url: data.spec.url,
                ...(encryptedCredentials ? { encryptedCredentials } : {}),
              },
            }

            if (current) {
              const result = await tx.pulumiStateBackend.updateMany({
                where: { id, revision: data.revision },
                data: { ...values, revision: { increment: 1 } },
              })

              assertChanged(kind, id, result.count)
            } else {
              await tx.pulumiStateBackend.create({ data: { id, ...values } })
            }

            return stateOutput(await tx.pulumiStateBackend.findUniqueOrThrow({ where: { id } }))
          }
          case "npm-registry-credential": {
            const data = npmRegistryCredentialInputSchema.parse(input)
            const current = await tx.npmRegistryCredential.findUnique({ where: { id } })
            assertRevision(kind, id, data.revision, current)

            const encryptedCredentials = await this.secret(
              data.credentials && JSON.stringify(data.credentials),
              current?.encryptedCredentials,
            )

            if (!encryptedCredentials) {
              throw new Error("Npm registry credentials are required")
            }

            const values = {
              meta: data.meta,
              scope: data.scope,
              registryUrl: data.registryUrl,
              encryptedCredentials,
            }

            if (current) {
              const result = await tx.npmRegistryCredential.updateMany({
                where: { id, revision: data.revision },
                data: { ...values, revision: { increment: 1 } },
              })

              assertChanged(kind, id, result.count)
            } else {
              await tx.npmRegistryCredential.create({ data: { id, ...values } })
            }

            return npmRegistryCredentialOutputSchema.parse({
              ...(await tx.npmRegistryCredential.findUniqueOrThrow({ where: { id } })),
              credentialsConfigured: true,
            })
          }
          case "container-registry-credential": {
            const data = containerRegistryCredentialInputSchema.parse(input)
            const current = await tx.containerRegistryCredential.findUnique({ where: { id } })
            assertRevision(kind, id, data.revision, current)

            const encryptedCredentials = await this.secret(
              data.credentials && JSON.stringify(data.credentials),
              current?.encryptedCredentials,
            )

            if (!encryptedCredentials) {
              throw new Error("Container registry credentials are required")
            }

            const values = { meta: data.meta, registryUrl: data.registryUrl, encryptedCredentials }

            if (current) {
              const result = await tx.containerRegistryCredential.updateMany({
                where: { id, revision: data.revision },
                data: { ...values, revision: { increment: 1 } },
              })

              assertChanged(kind, id, result.count)
            } else {
              await tx.containerRegistryCredential.create({ data: { id, ...values } })
            }

            return containerRegistryCredentialOutputSchema.parse({
              ...(await tx.containerRegistryCredential.findUniqueOrThrow({ where: { id } })),
              credentialsConfigured: true,
            })
          }
        }
      })
    } catch (error) {
      if (isDatabaseError(error, "P2002") && input.revision === 0) {
        throw new RuntimeSettingsConflictError(kind, id)
      }

      throw error
    }
  }

  /**
   * Deletes an unreferenced setting only when its revision still matches.
   * Runtime workload and image history must be removed before deleting its runtime.
   */
  async delete(
    context: BackendRequestContext,
    kind: RuntimeSettingsKind,
    id: string,
    revision: number,
  ): Promise<void> {
    runtimeSettingsKindSchema.parse(kind)
    requireBackendPermission(context, `${kind}.manage`, { resourceId: id })

    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new Error("A positive revision is required")
    }

    try {
      await this.database.backend.$transaction(async tx => {
        const where = { id, revision }
        let count: number

        switch (kind) {
          case "container-runtime": {
            assertRevision(
              kind,
              id,
              revision,
              await tx.containerRuntime.findUnique({ where: { id } }),
            )

            if (
              (await tx.project.count({ where: { containerRuntimeId: id } })) ||
              (await tx.runtimeWorkload.count({ where: { runtimeId: id } })) ||
              (await tx.librarySnapshotImage.count({ where: { runtimeId: id } }))
            ) {
              throw new RuntimeSettingsInUseError(kind, id)
            }

            count = (await tx.containerRuntime.deleteMany({ where })).count
            break
          }
          case "pulumi-state-backend":
            assertRevision(
              kind,
              id,
              revision,
              await tx.pulumiStateBackend.findUnique({ where: { id } }),
            )
            if (await tx.project.count({ where: { pulumiStateBackendId: id } })) {
              throw new RuntimeSettingsInUseError(kind, id)
            }

            count = (await tx.pulumiStateBackend.deleteMany({ where })).count
            break
          case "npm-registry-credential":
            assertRevision(
              kind,
              id,
              revision,
              await tx.npmRegistryCredential.findUnique({ where: { id } }),
            )
            await assertCredentialUnused(tx, kind, id)
            count = (await tx.npmRegistryCredential.deleteMany({ where })).count
            break
          case "container-registry-credential":
            assertRevision(
              kind,
              id,
              revision,
              await tx.containerRegistryCredential.findUnique({ where: { id } }),
            )
            await assertCredentialUnused(tx, kind, id)
            count = (await tx.containerRegistryCredential.deleteMany({ where })).count
            break
        }

        assertChanged(kind, id, count)
      })
    } catch (error) {
      if (isDatabaseError(error, "P2003")) {
        throw new RuntimeSettingsInUseError(kind, id)
      }

      throw error
    }
  }

  /**
   * Delegates connectivity checks to the configured runtime adapter.
   * Missing providers and adapter failures reject the request.
   */
  async preflight(
    context: BackendRequestContext,
    runtimeId: string,
    signal?: AbortSignal,
  ): Promise<RuntimePreflightCheck[]> {
    requireBackendPermission(context, "container-runtime.manage", { resourceId: runtimeId })

    await this.database.backend.containerRuntime.findUniqueOrThrow({
      where: { id: runtimeId },
      select: { id: true },
    })

    if (!this.preflightProvider) {
      throw new Error("Runtime preflight provider is not configured")
    }

    const adapter = await this.preflightProvider.get(runtimeId)
    return await adapter.preflight(signal)
  }

  private async secret(
    value: string | null | undefined,
    previous?: string,
  ): Promise<string | undefined> {
    switch (value) {
      case undefined:
        return previous
      case null:
        return undefined
    }

    const encrypter = new Encrypter()
    encrypter.addRecipient(await identityToRecipient(this.privateKey))
    return armor.encode(await encrypter.encrypt(value))
  }

  private async runtimeSpec(
    input: ContainerRuntimeInputSpec,
    previous?: ContainerRuntimeSpec,
  ): Promise<ContainerRuntimeSpec> {
    const common = {
      runtimeApiUrl: input.runtimeApiUrl,
      ...(input.runtimeApiCaBundle ? { runtimeApiCaBundle: input.runtimeApiCaBundle } : {}),
      ...(input.imageRepository ? { imageRepository: input.imageRepository } : {}),
    }

    if (input.type === "kubernetes") {
      const encryptedKubeconfig = await this.secret(
        input.kubeconfig,
        previous?.type === "kubernetes" ? previous.encryptedKubeconfig : undefined,
      )

      return {
        ...common,
        type: input.type,
        namespace: input.namespace,
        serviceAccount: input.serviceAccount,
        buildkitImage: input.buildkitImage,
        ...(input.context ? { context: input.context } : {}),
        ...(encryptedKubeconfig ? { encryptedKubeconfig } : {}),
      }
    }

    const oldTls = previous?.type === "docker" ? previous.tls : undefined
    const encryptedCaBundle = await this.secret(input.tls?.caBundle, oldTls?.encryptedCaBundle)

    const encryptedClientCertificate = await this.secret(
      input.tls?.clientCertificate,
      oldTls?.encryptedClientCertificate,
    )

    const encryptedClientKey = await this.secret(input.tls?.clientKey, oldTls?.encryptedClientKey)
    return {
      ...common,
      type: input.type,
      engineEndpoint: input.engineEndpoint,
      local: input.local,
      tls: {
        ...(encryptedCaBundle ? { encryptedCaBundle } : {}),
        ...(encryptedClientCertificate ? { encryptedClientCertificate } : {}),
        ...(encryptedClientKey ? { encryptedClientKey } : {}),
      },
    }
  }
}

function runtimeOutput(
  row: ContainerRuntime & {
    npmRegistryCredentials: { id: string }[]
    containerRegistryCredentials: { id: string }[]
  },
) {
  const spec = row.spec
  return containerRuntimeOutputSchema.parse({
    ...row,
    spec:
      spec.type === "docker"
        ? {
            ...spec,
            tls: {
              caBundleConfigured: !!spec.tls?.encryptedCaBundle,
              clientCertificateConfigured: !!spec.tls?.encryptedClientCertificate,
              clientKeyConfigured: !!spec.tls?.encryptedClientKey,
            },
          }
        : { ...spec, kubeconfigConfigured: !!spec.encryptedKubeconfig },
    npmRegistryCredentialIds: row.npmRegistryCredentials.map(row => row.id),
    containerRegistryCredentialIds: row.containerRegistryCredentials.map(row => row.id),
  })
}

function stateOutput(row: PulumiStateBackend) {
  return pulumiStateBackendOutputSchema.parse({
    ...row,
    spec: { url: row.spec.url, credentialsConfigured: !!row.spec.encryptedCredentials },
  })
}

function assertRevision(
  kind: RuntimeSettingsKind,
  id: string,
  revision: number,
  current: { revision: number } | null,
) {
  if (current ? revision !== current.revision : revision !== 0) {
    throw new RuntimeSettingsConflictError(kind, id)
  }
}

function assertChanged(kind: RuntimeSettingsKind, id: string, count: number) {
  if (count !== 1) {
    throw new RuntimeSettingsConflictError(kind, id)
  }
}

function isDatabaseError(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

async function assertCredentialUnused(
  tx: BackendTransaction,
  kind: "npm-registry-credential" | "container-registry-credential",
  id: string,
) {
  const count = await tx.containerRuntime.count({
    where:
      kind === "npm-registry-credential"
        ? { npmRegistryCredentials: { some: { id } } }
        : { containerRegistryCredentials: { some: { id } } },
  })

  if (count) {
    throw new RuntimeSettingsInUseError(kind, id)
  }
}

import type { ServiceImpl } from "@connectrpc/connect"
import type { RuntimeSettingsService } from "@highstate/api/v1"
import type { Services } from "@highstate/backend"
import { randomUUID } from "node:crypto"
import { Code, ConnectError } from "@connectrpc/connect"
import {
  containerRegistryCredentialInputSchema,
  containerRuntimeInputSchema,
  npmRegistryCredentialInputSchema,
  pulumiStateBackendInputSchema,
} from "@highstate/backend/shared"
import { z } from "@highstate/contract"
import { authenticateBackend, parseValue } from "../shared"
import {
  toContainerRegistryCredential,
  toContainerRuntime,
  toNpmRegistryCredential,
  toPulumiStateBackend,
} from "../shared/runtime-settings"

const decoder = new TextDecoder("utf-8", { fatal: true })

function secret(value: Uint8Array | undefined, clear = false): string | null | undefined {
  if (clear && value !== undefined)
    throw new ConnectError("Cannot replace and clear the same secret", Code.InvalidArgument)
  if (clear) return null
  if (value === undefined) return undefined
  try {
    return decoder.decode(value)
  } catch {
    throw new ConnectError("Secret must be UTF-8 text", Code.InvalidArgument)
  }
}

function credentials(value: Uint8Array | undefined): unknown {
  const text = secret(value)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text!)
  } catch {
    throw new ConnectError("Credentials must be a JSON object", Code.InvalidArgument)
  }
}

function revision(value: bigint | undefined, id: string): number {
  if (value === undefined && id)
    throw new ConnectError("Expected revision is required", Code.InvalidArgument)
  const number = Number(value ?? 0n)
  if (!Number.isSafeInteger(number) || number < 0)
    throw new ConnectError("Invalid expected revision", Code.InvalidArgument)
  return number
}

function requiredId(id: string): string {
  return parseValue(id, "id", z.string().min(1))
}

export function createRuntimeSettingsService(
  services: Services,
): ServiceImpl<typeof RuntimeSettingsService> {
  const service = services.runtimeSettingsService
  return {
    async listContainerRuntimes(_request, context) {
      const auth = await authenticateBackend(services, context)
      return { runtimes: (await service.list(auth, "container-runtime")).map(toContainerRuntime) }
    },
    async putContainerRuntime(request, context) {
      const auth = await authenticateBackend(services, context)
      const runtime = request.runtime
      if (!runtime?.spec)
        throw new ConnectError("Runtime and spec are required", Code.InvalidArgument)
      const spec = runtime.spec
      const selected = spec.runtime
      const common = {
        runtimeApiUrl: spec.runtimeApiUrl,
        runtimeApiCaBundle: secret(spec.runtimeApiCaBundle),
        imageRepository: spec.imageRepository,
      }
      const input = parseValue(
        {
          meta: runtime.meta,
          revision: revision(request.expectedRevision, runtime.id),
          npmRegistryCredentialIds: runtime.npmRegistryCredentialIds,
          containerRegistryCredentialIds: runtime.containerRegistryCredentialIds,
          spec:
            selected.case === "docker"
              ? {
                  ...common,
                  type: "docker",
                  engineEndpoint: selected.value.engineEndpoint,
                  local: selected.value.local,
                  tls: selected.value.tls
                    ? {
                        caBundle: secret(
                          selected.value.tls.caBundle,
                          selected.value.tls.clearCaBundle,
                        ),
                        clientCertificate: secret(
                          selected.value.tls.clientCertificate,
                          selected.value.tls.clearClientCertificate,
                        ),
                        clientKey: secret(
                          selected.value.tls.clientKey,
                          selected.value.tls.clearClientKey,
                        ),
                      }
                    : undefined,
                }
              : selected.case === "kubernetes"
                ? {
                    ...common,
                    type: "kubernetes",
                    kubeconfig: secret(selected.value.kubeconfig, selected.value.clearKubeconfig),
                    context: selected.value.context,
                    namespace: selected.value.namespace,
                    serviceAccount: selected.value.serviceAccount,
                    buildkitImage: selected.value.buildkitImage,
                  }
                : undefined,
        },
        "runtime",
        containerRuntimeInputSchema,
      )
      return {
        runtime: toContainerRuntime(
          await service.put(auth, "container-runtime", runtime.id || randomUUID(), input),
        ),
      }
    },
    async deleteContainerRuntime(request, context) {
      const auth = await authenticateBackend(services, context)
      await service.delete(
        auth,
        "container-runtime",
        requiredId(request.containerRuntimeId),
        revision(request.expectedRevision, request.containerRuntimeId),
      )
      return {}
    },
    async checkContainerRuntime(request, context) {
      const auth = await authenticateBackend(services, context)
      const checks = await service.preflight(
        auth,
        requiredId(request.containerRuntimeId),
        context.signal,
      )
      if (
        request.probeRuntimeApi &&
        !checks.some(check => check.name === "authenticated-agent-stream")
      ) {
        checks.push({
          name: "authenticated-agent-stream",
          ok: false,
          detail: "Configure an authenticated workload probe for this runtime in the backend",
        })
      }
      return {
        ready: checks.every(check => check.ok),
        checks: checks.map(check => ({
          name: check.name,
          passed: check.ok,
          message: check.detail,
        })),
      }
    },
    async listPulumiStateBackends(_request, context) {
      const auth = await authenticateBackend(services, context)
      return {
        backends: (await service.list(auth, "pulumi-state-backend")).map(toPulumiStateBackend),
      }
    },
    async putPulumiStateBackend(request, context) {
      const auth = await authenticateBackend(services, context)
      const backend = request.backend
      if (!backend) throw new ConnectError("Backend is required", Code.InvalidArgument)
      const input = parseValue(
        {
          meta: backend.meta,
          revision: revision(request.expectedRevision, backend.id),
          spec: {
            url: backend.url,
            credentials: secret(backend.credentials, backend.clearCredentials),
          },
        },
        "backend",
        pulumiStateBackendInputSchema,
      )
      return {
        backend: toPulumiStateBackend(
          await service.put(auth, "pulumi-state-backend", backend.id || randomUUID(), input),
        ),
      }
    },
    async deletePulumiStateBackend(request, context) {
      const auth = await authenticateBackend(services, context)
      await service.delete(
        auth,
        "pulumi-state-backend",
        requiredId(request.pulumiStateBackendId),
        revision(request.expectedRevision, request.pulumiStateBackendId),
      )
      return {}
    },
    async listNpmRegistryCredentials(_request, context) {
      const auth = await authenticateBackend(services, context)
      return {
        credentials: (await service.list(auth, "npm-registry-credential")).map(
          toNpmRegistryCredential,
        ),
      }
    },
    async putNpmRegistryCredential(request, context) {
      const auth = await authenticateBackend(services, context)
      const credential = request.credential
      if (!credential) throw new ConnectError("Credential is required", Code.InvalidArgument)
      const input = parseValue(
        {
          meta: credential.meta,
          revision: revision(request.expectedRevision, credential.id),
          scope: credential.scope,
          registryUrl: credential.registryUrl,
          credentials: credentials(credential.credentials),
        },
        "credential",
        npmRegistryCredentialInputSchema,
      )
      return {
        credential: toNpmRegistryCredential(
          await service.put(auth, "npm-registry-credential", credential.id || randomUUID(), input),
        ),
      }
    },
    async deleteNpmRegistryCredential(request, context) {
      const auth = await authenticateBackend(services, context)
      await service.delete(
        auth,
        "npm-registry-credential",
        requiredId(request.npmRegistryCredentialId),
        revision(request.expectedRevision, request.npmRegistryCredentialId),
      )
      return {}
    },
    async listContainerRegistryCredentials(_request, context) {
      const auth = await authenticateBackend(services, context)
      return {
        credentials: (await service.list(auth, "container-registry-credential")).map(
          toContainerRegistryCredential,
        ),
      }
    },
    async putContainerRegistryCredential(request, context) {
      const auth = await authenticateBackend(services, context)
      const credential = request.credential
      if (!credential) throw new ConnectError("Credential is required", Code.InvalidArgument)
      const input = parseValue(
        {
          meta: credential.meta,
          revision: revision(request.expectedRevision, credential.id),
          registryUrl: credential.registryUrl,
          credentials: credentials(credential.credentials),
        },
        "credential",
        containerRegistryCredentialInputSchema,
      )
      return {
        credential: toContainerRegistryCredential(
          await service.put(
            auth,
            "container-registry-credential",
            credential.id || randomUUID(),
            input,
          ),
        ),
      }
    },
    async deleteContainerRegistryCredential(request, context) {
      const auth = await authenticateBackend(services, context)
      await service.delete(
        auth,
        "container-registry-credential",
        requiredId(request.containerRegistryCredentialId),
        revision(request.expectedRevision, request.containerRegistryCredentialId),
      )
      return {}
    },
  }
}

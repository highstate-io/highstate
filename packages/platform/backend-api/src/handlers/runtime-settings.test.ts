import { create } from "@bufbuild/protobuf"
import { Code } from "@connectrpc/connect"
import {
  CheckContainerRuntimeRequestSchema,
  DeleteContainerRuntimeRequestSchema,
  PutContainerRuntimeRequestSchema,
  PutNpmRegistryCredentialRequestSchema,
} from "@highstate/api/v1"
import { describe, expect, it, vi } from "vitest"
import { createRuntimeSettingsService } from "./runtime-settings"

const context = { requestHeader: new Headers({ authorization: "Bearer backend-key" }) }

function fixture() {
  const output = {
    id: "runtime",
    meta: { title: "Remote engine" },
    revision: 3,
    createdAt: new Date(0),
    updatedAt: new Date(1),
    npmRegistryCredentialIds: [],
    containerRegistryCredentialIds: [],
    spec: {
      type: "docker",
      engineEndpoint: "https://engine.example",
      local: false,
      runtimeApiUrl: "https://runtime.example",
      imageRepository: "registry.example/library",
      tls: {
        caBundleConfigured: true,
        clientCertificateConfigured: true,
        clientKeyConfigured: true,
      },
    },
  }
  const put = vi.fn(async () => output)
  const remove = vi.fn()
  const preflight = vi.fn(async () => [{ name: "connectivity", ok: true }])
  return {
    put,
    remove,
    preflight,
    handler: createRuntimeSettingsService({
      runtimeSettingsService: { put, delete: remove, preflight },
      apiKeyService: {
        getBackendApiKeyByToken: async () => ({
          id: "key",
          serviceAccountId: "account",
          restrictionRules: [],
        }),
      },
      database: { backend: { serviceAccountBackendRoleBinding: { findMany: async () => [] } } },
    } as never),
  }
}

describe("runtime settings transport", () => {
  it("does not claim workload reachability when the configured preflight omitted the requested probe", async () => {
    const { handler, preflight } = fixture()
    const result = await handler.checkContainerRuntime(
      create(CheckContainerRuntimeRequestSchema, {
        containerRuntimeId: "runtime",
        probeRuntimeApi: true,
      }),
      context as never,
    )
    expect(preflight).toHaveBeenCalledOnce()
    expect(result.ready).toBe(false)
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: "authenticated-agent-stream", passed: false }),
    )
  })
  it("preserves omitted secrets and forwards explicit clears without returning secret material", async () => {
    const { put, handler } = fixture()
    const request = create(PutContainerRuntimeRequestSchema, {
      expectedRevision: 2n,
      runtime: {
        id: "runtime",
        meta: { title: "Remote engine" },
        spec: {
          runtimeApiUrl: "https://runtime.example",
          imageRepository: "registry.example/library",
          runtime: {
            case: "docker",
            value: { engineEndpoint: "https://engine.example", tls: { clearCaBundle: true } },
          },
        },
      },
    })
    const response = await handler.putContainerRuntime(request, context as never)
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        realm: "backend",
        subject: expect.objectContaining({ serviceAccountId: "account" }),
      }),
      "container-runtime",
      "runtime",
      expect.objectContaining({
        revision: 2,
        spec: expect.objectContaining({
          tls: { caBundle: null, clientCertificate: undefined, clientKey: undefined },
        }),
      }),
    )
    expect(response.runtime?.spec?.runtime).toMatchObject({
      case: "docker",
      value: { tls: { configured: true, clientKeyConfigured: true } },
    })
    const selected = response.runtime?.spec?.runtime
    expect(selected?.case === "docker" ? selected.value.tls?.clientKey : undefined).toBeUndefined()
  })

  it("rejects missing update and delete revisions before mutation", async () => {
    const { put, remove, handler } = fixture()
    await expect(
      handler.putContainerRuntime(
        create(PutContainerRuntimeRequestSchema, { runtime: { id: "runtime", spec: {} } }),
        context as never,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument })
    await expect(
      handler.deleteContainerRuntime(
        create(DeleteContainerRuntimeRequestSchema, { containerRuntimeId: "runtime" }),
        context as never,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument })
    expect(put).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it("rejects invalid credential JSON and simultaneous clear/replace", async () => {
    const { put, handler } = fixture()
    await expect(
      handler.putNpmRegistryCredential(
        create(PutNpmRegistryCredentialRequestSchema, {
          credential: { credentials: new TextEncoder().encode("not-json") },
        }),
        context as never,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument })
    await expect(
      handler.putContainerRuntime(
        create(PutContainerRuntimeRequestSchema, {
          runtime: {
            spec: {
              runtime: {
                case: "kubernetes",
                value: { kubeconfig: new TextEncoder().encode("secret"), clearKubeconfig: true },
              },
            },
          },
        }),
        context as never,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument })
    expect(put).not.toHaveBeenCalled()
  })
})

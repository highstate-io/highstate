import { create } from "@bufbuild/protobuf"
import { Code } from "@connectrpc/connect"
import {
  CheckContainerRuntimeRequestSchema,
  DeleteContainerRuntimeRequestSchema,
  PutContainerRuntimeRequestSchema,
  PutNpmRegistryCredentialRequestSchema,
} from "@highstate/api/v1"
import { cuidv2d } from "@highstate/contract"
import { describe, expect, it, vi } from "vitest"
import { createRuntimeSettingsService } from "./runtime-settings"

const context = { requestHeader: new Headers({ authorization: "Bearer backend-key" }) }
const runtimeId = cuidv2d("runtime-settings-transport-test", "runtime")
const previousRevision = cuidv2d("runtime-settings-transport-test", "previous-revision")
const currentRevision = cuidv2d("runtime-settings-transport-test", "current-revision")

function fixture() {
  const output = {
    id: runtimeId,
    systemName: null,
    meta: { title: "Remote engine" },
    revision: currentRevision,
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
  it("generates CUIDs for creates and rejects user-chosen identifiers", async () => {
    const { handler, put } = fixture()

    const runtime = {
      meta: { title: "Local" },
      spec: {
        runtimeApiUrl: "https://runtime.example",
        runtime: {
          case: "docker" as const,
          value: { engineEndpoint: "unix:///var/run/docker.sock", local: true },
        },
      },
    }

    await handler.putContainerRuntime(
      create(PutContainerRuntimeRequestSchema, { runtime }),
      context as never,
    )

    expect(put).toHaveBeenCalledWith(
      expect.anything(),
      "container-runtime",
      expect.stringMatching(/^[a-z][a-z0-9]{23}$/),
      expect.anything(),
    )

    put.mockClear()

    await expect(
      handler.putContainerRuntime(
        create(PutContainerRuntimeRequestSchema, {
          expectedRevision: previousRevision,
          runtime: { ...runtime, id: "human-name" },
        }),
        context as never,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument })

    expect(put).not.toHaveBeenCalled()
  })

  it("does not claim workload reachability when the configured preflight omitted the requested probe", async () => {
    const { handler, preflight } = fixture()

    const result = await handler.checkContainerRuntime(
      create(CheckContainerRuntimeRequestSchema, {
        containerRuntimeId: runtimeId,
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
      expectedRevision: previousRevision,
      runtime: {
        id: runtimeId,
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
      runtimeId,
      expect.objectContaining({
        revision: previousRevision,
        spec: expect.objectContaining({
          tls: { caBundle: null, clientCertificate: undefined, clientKey: undefined },
        }),
      }),
    )

    expect(response.runtime?.spec?.runtime).toMatchObject({
      case: "docker",
      value: {
        tls: {
          caBundleConfigured: true,
          clientCertificateConfigured: true,
          clientKeyConfigured: true,
        },
      },
    })

    const selected = response.runtime?.spec?.runtime
    expect(selected?.case === "docker" ? selected.value.tls?.clientKey : undefined).toBeUndefined()
  })

  it("rejects missing update and delete revisions before mutation", async () => {
    const { put, remove, handler } = fixture()

    await expect(
      handler.putContainerRuntime(
        create(PutContainerRuntimeRequestSchema, { runtime: { id: runtimeId, spec: {} } }),
        context as never,
      ),
    ).rejects.toMatchObject({ code: Code.InvalidArgument })

    await expect(
      handler.deleteContainerRuntime(
        create(DeleteContainerRuntimeRequestSchema, { containerRuntimeId: runtimeId }),
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

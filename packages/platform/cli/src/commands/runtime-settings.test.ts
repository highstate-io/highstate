import type { HighstateClients } from "../shared/remote"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { create } from "@bufbuild/protobuf"
import {
  CheckContainerRuntimeResponseSchema,
  ContainerRegistryCredentialSchema,
  ContainerRuntimeSchema,
  NpmRegistryCredentialSchema,
  PulumiStateBackendSchema,
} from "@highstate/api/v1"
import { Cli } from "clipanion"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RemoteCommand } from "./remote"
import * as commands from "./runtime-settings"

const runtime = create(ContainerRuntimeSchema, {
  id: "runtime-1",
  revision: 7n,
  meta: { title: "Docker" },
  spec: {
    runtimeApiUrl: "https://backend.example",
    runtime: {
      case: "docker",
      value: {
        engineEndpoint: "unix:///var/run/docker.sock",
        local: true,
        tls: { clientKey: Buffer.from("private-key"), clientKeyConfigured: true },
      },
    },
  },
})
const backend = create(PulumiStateBackendSchema, {
  id: "backend-1",
  revision: 7n,
  meta: { title: "State" },
  url: "s3://state",
  credentials: Buffer.from("private-token"),
  credentialsConfigured: true,
})
const npm = create(NpmRegistryCredentialSchema, {
  id: "npm-1",
  revision: 7n,
  meta: { title: "Npm" },
  scope: "@example",
  registryUrl: "https://registry.npmjs.org",
  credentials: Buffer.from("private-token"),
})
const container = create(ContainerRegistryCredentialSchema, {
  id: "container-1",
  revision: 7n,
  meta: { title: "OCI" },
  registryUrl: "ghcr.io",
  credentials: Buffer.from("private-token"),
})

function settingsClient() {
  return {
    listContainerRuntimes: vi.fn().mockResolvedValue({ runtimes: [runtime] }),
    putContainerRuntime: vi.fn().mockResolvedValue({ runtime }),
    deleteContainerRuntime: vi.fn().mockResolvedValue({}),
    checkContainerRuntime: vi
      .fn()
      .mockResolvedValue(create(CheckContainerRuntimeResponseSchema, { ready: true })),
    listPulumiStateBackends: vi.fn().mockResolvedValue({ backends: [backend] }),
    putPulumiStateBackend: vi.fn().mockResolvedValue({ backend }),
    deletePulumiStateBackend: vi.fn().mockResolvedValue({}),
    listNpmRegistryCredentials: vi.fn().mockResolvedValue({ credentials: [npm] }),
    putNpmRegistryCredential: vi.fn().mockResolvedValue({ credential: npm }),
    deleteNpmRegistryCredential: vi.fn().mockResolvedValue({}),
    listContainerRegistryCredentials: vi.fn().mockResolvedValue({ credentials: [container] }),
    putContainerRegistryCredential: vi.fn().mockResolvedValue({ credential: container }),
    deleteContainerRegistryCredential: vi.fn().mockResolvedValue({}),
  }
}

describe("registered runtime settings commands", () => {
  let cli: Cli
  let client: ReturnType<typeof settingsClient>
  let directory: string
  let stdout: string
  let stderr: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "highstate-runtime-settings-"))
    stdout = ""
    stderr = ""
    cli = new Cli({ binaryName: "highstate" })

    for (const command of Object.values(commands)) {
      cli.register(command)
    }

    client = settingsClient()

    vi.spyOn(RemoteCommand.prototype, "remote").mockResolvedValue({
      clients: { runtimeSettings: client } as unknown as HighstateClients,
      target: { apiUrl: "https://backend.example", apiToken: "token", projectId: "" },
    })

    vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
      stdout += String(chunk)
      return true
    })

    vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
      stderr += String(chunk)
      return true
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    process.exitCode = 0
    await rm(directory, { recursive: true, force: true })
  })

  async function file(content: string, name = "settings.yaml"): Promise<string> {
    const path = join(directory, name)
    await writeFile(path, content)
    return path
  }

  async function run(...args: string[]): Promise<number> {
    return await cli.run([...args, "--output", "json"])
  }

  const resources = [
    {
      path: "runtime",
      id: "runtime-1",
      collection: "runtimes",
      singular: "runtime",
      list: "listContainerRuntimes",
      put: "putContainerRuntime",
      delete: "deleteContainerRuntime",
      idField: "containerRuntimeId",
      document: {
        meta: { title: "Docker" },
        spec: {
          docker: { engine_endpoint: "unix:///var/run/docker.sock", local: true },
          runtime_api_url: "https://backend.example",
        },
      },
    },
    {
      path: "pulumi-state-backend",
      id: "backend-1",
      collection: "backends",
      singular: "backend",
      list: "listPulumiStateBackends",
      put: "putPulumiStateBackend",
      delete: "deletePulumiStateBackend",
      idField: "pulumiStateBackendId",
      document: { meta: { title: "State" }, url: "s3://state" },
    },
    {
      path: "npm-registry-credential",
      id: "npm-1",
      collection: "credentials",
      singular: "credential",
      list: "listNpmRegistryCredentials",
      put: "putNpmRegistryCredential",
      delete: "deleteNpmRegistryCredential",
      idField: "npmRegistryCredentialId",
      document: {
        meta: { title: "Npm" },
        scope: "@example",
        registry_url: "https://registry.npmjs.org",
      },
    },
    {
      path: "container-registry-credential",
      id: "container-1",
      collection: "credentials",
      singular: "credential",
      list: "listContainerRegistryCredentials",
      put: "putContainerRegistryCredential",
      delete: "deleteContainerRegistryCredential",
      idField: "containerRegistryCredentialId",
      document: { meta: { title: "OCI" }, registry_url: "ghcr.io" },
    },
  ] as const

  it.each(
    resources,
  )("lists and gets $path through the list RPC without revealing secrets", async resource => {
    expect(await run(resource.path, "list")).toBe(0)

    expect(JSON.parse(stdout)[resource.collection][0]).toMatchObject({
      id: resource.id,
      revision: "7",
    })

    expect(stdout).not.toContain(Buffer.from("private-token").toString("base64"))
    expect(stdout).not.toContain(Buffer.from("private-key").toString("base64"))
    stdout = ""
    expect(await run(resource.path, "get", resource.id)).toBe(0)
    expect(JSON.parse(stdout)[resource.singular].id).toBe(resource.id)
    expect(client[resource.list]).toHaveBeenCalledTimes(2)
    expect(RemoteCommand.prototype.remote).toHaveBeenCalledWith(false)
    expect(stdout).not.toContain('"credentials":')
    expect(stdout).not.toContain('"client_key":')
  })

  it.each(
    resources,
  )("creates, replaces, and deletes $path with explicit concurrency", async resource => {
    const path = await file(JSON.stringify(resource.document))
    expect(await run(resource.path, "create", "--file", path)).toBe(0)

    expect(client[resource.put]).toHaveBeenLastCalledWith(
      expect.objectContaining({
        [resource.singular]: expect.objectContaining({ id: "" }),
        expectedRevision: undefined,
      }),
    )

    expect(
      await run(
        resource.path,
        "update",
        resource.id,
        "--file",
        path,
        "--expected-revision",
        "9007199254740993",
      ),
    ).toBe(0)

    expect(client[resource.put]).toHaveBeenLastCalledWith(
      expect.objectContaining({
        [resource.singular]: expect.objectContaining({ id: resource.id }),
        expectedRevision: 9007199254740993n,
      }),
    )

    expect(await run(resource.path, "delete", resource.id, "--expected-revision", "7")).toBe(0)

    expect(client[resource.delete]).toHaveBeenCalledWith({
      [resource.idField]: resource.id,
      expectedRevision: 7n,
    })

    expect(stdout).not.toContain(Buffer.from("private-token").toString("base64"))
  })

  it.each(resources)("rejects blind writes and missing IDs for $path", async resource => {
    const path = await file(
      JSON.stringify({ ...resource.document, id: resource.id, revision: "7" }),
    )

    await run(resource.path, "put", "--file", path)
    expect(stderr).toContain("--expected-revision")
    expect(client[resource.put]).not.toHaveBeenCalled()
    stderr = ""
    await run(resource.path, "create", "--file", path)
    expect(stderr).toContain("empty setting ID")
    stderr = ""
    await run(resource.path, "get", "missing")
    expect(JSON.parse(stderr).error.message).toBe('Setting "missing" not found')
    expect(await run(resource.path, "delete", resource.id)).toBe(1)
    expect(client[resource.delete]).not.toHaveBeenCalled()
  })

  it.each([
    "0",
    "-1",
    "1.5",
    "18446744073709551616",
    "invalid",
  ])("rejects invalid existing revisions %s before an RPC", async revision => {
    await run("runtime", "delete", "runtime-1", `--expected-revision=${revision}`)
    expect(client.deleteContainerRuntime).not.toHaveBeenCalled()
    expect(stderr).toContain("revision")
  })

  it("requires an ID for update and rejects conflicting document IDs", async () => {
    const path = await file("meta: {title: State}\nurl: s3://state\n")
    await run("pulumi-state-backend", "update", "--file", path)
    expect(stderr).toContain("Update requires a setting ID")
    await writeFile(path, "id: backend-1\nmeta: {title: State}\nurl: s3://state\n")
    await run("pulumi-state-backend", "put", "other-id", "--file", path)
    expect(stderr).toContain("Document ID does not match")
    expect(client.putPulumiStateBackend).not.toHaveBeenCalled()
  })

  it.each([
    "",
    "IAo=",
  ])("preserves stored credentials when a document secret is blank (%s)", async credentials => {
    const path = await file(
      JSON.stringify({
        id: "npm-1",
        meta: { title: "Registry" },
        registry_url: "https://registry.npmjs.org",
        credentials,
      }),
    )

    await run("npm-registry-credential", "put", "--file", path, "--expected-revision", "7")
    expect(client.putNpmRegistryCredential).toHaveBeenCalledOnce()
    expect(client.putNpmRegistryCredential.mock.calls[0]![0].credential.credentials).toBeUndefined()
  })

  it("reads YAML documents and raw credentials from a file without echoing secrets", async () => {
    const path = await file("meta:\n  title: Registry\nregistry_url: ghcr.io\n")
    const secret = await file("username:password", "credentials")

    expect(
      await run(
        "container-registry-credential",
        "put",
        "--file",
        path,
        "--credentials-file",
        secret,
      ),
    ).toBe(0)

    expect(client.putContainerRegistryCredential).toHaveBeenCalledWith({
      credential: expect.objectContaining({
        registryUrl: "ghcr.io",
        credentials: Buffer.from("username:password"),
      }),
      expectedRevision: undefined,
    })

    expect(stdout + stderr).not.toContain("username:password")
  })

  it("reads a document from stdin and preserves blank secrets while honoring explicit clear", async () => {
    const text = vi
      .spyOn(Bun.stdin, "text")
      .mockResolvedValue(
        "id: backend-1\nmeta: {title: State}\nurl: s3://state\ncredentials: 'IAo='\nclear_credentials: true\n",
      )

    expect(
      await run("pulumi-state-backend", "put", "--file", "-", "--expected-revision", "7"),
    ).toBe(0)

    expect(text).toHaveBeenCalledOnce()

    expect(client.putPulumiStateBackend).toHaveBeenCalledWith({
      backend: expect.objectContaining({ clearCredentials: true }),
      expectedRevision: 7n,
    })

    expect(client.putPulumiStateBackend.mock.calls[0]![0].backend.credentials).toBeUndefined()
  })

  it("reads raw credentials from stdin and rejects competing stdin consumers", async () => {
    const path = await file("meta: {title: Npm}\nregistry_url: https://registry.npmjs.org\n")

    vi.spyOn(Bun.stdin, "arrayBuffer").mockResolvedValue(
      new TextEncoder().encode("stdin-token").buffer,
    )

    vi.spyOn(Bun.stdin, "text").mockResolvedValue("meta: {title: Npm}")

    expect(
      await run("npm-registry-credential", "put", "--file", path, "--credentials-file", "-"),
    ).toBe(0)

    expect(client.putNpmRegistryCredential).toHaveBeenCalledWith({
      credential: expect.objectContaining({ credentials: Buffer.from("stdin-token") }),
      expectedRevision: undefined,
    })

    client.putNpmRegistryCredential.mockClear()
    await run("npm-registry-credential", "put", "--file", "-", "--credentials-file", "-")
    expect(stderr).toContain("Stdin may only be used for one input")
    expect(client.putNpmRegistryCredential).not.toHaveBeenCalled()
  })

  it("omits whitespace-only credentials from files and supports explicit Pulumi clear", async () => {
    const path = await file("id: backend-1\nmeta: {title: State}\nurl: s3://state\n")
    const secret = await file(" \n\t", "credentials")

    await run(
      "pulumi-state-backend",
      "put",
      "--file",
      path,
      "--credentials-file",
      secret,
      "--expected-revision",
      "7",
      "--clear-credentials",
    )

    expect(client.putPulumiStateBackend).toHaveBeenCalledWith({
      backend: expect.objectContaining({ clearCredentials: true }),
      expectedRevision: 7n,
    })

    expect(client.putPulumiStateBackend.mock.calls[0]![0].backend.credentials).toBeUndefined()
  })

  it("loads Docker TLS files and preserves omitted keys and explicit clear fields", async () => {
    const path = await file(
      JSON.stringify({
        id: "runtime-1",
        spec: {
          docker: {
            engine_endpoint: "tcp://docker:2376",
            tls: { client_key: "", clear_client_key: true },
          },
          runtime_api_url: "https://backend.example",
        },
      }),
    )

    const ca = await file("CA CONTENT", "ca.pem")
    const certificate = await file("CERTIFICATE CONTENT", "client.pem")

    await run(
      "runtime",
      "put",
      "--file",
      path,
      "--expected-revision",
      "7",
      "--docker-ca-bundle-file",
      ca,
      "--docker-client-certificate-file",
      certificate,
    )

    expect(client.putContainerRuntime).toHaveBeenCalledWith({
      runtime: expect.objectContaining({
        spec: expect.objectContaining({
          runtime: {
            case: "docker",
            value: expect.objectContaining({
              tls: expect.objectContaining({
                caBundle: Buffer.from("CA CONTENT"),
                clientCertificate: Buffer.from("CERTIFICATE CONTENT"),
                clearClientKey: true,
              }),
            }),
          },
        }),
      }),
      expectedRevision: 7n,
    })

    expect(
      client.putContainerRuntime.mock.calls[0]![0].runtime.spec.runtime.value.tls.clientKey,
    ).toBeUndefined()
  })

  it("loads Kubernetes kubeconfig and the workload API CA without losing the full spec", async () => {
    const path = await file(
      JSON.stringify({
        spec: {
          kubernetes: {
            namespace: "highstate",
            service_account: "worker",
            buildkit_image: "buildkit:rootless",
            context: "production",
          },
          image_repository: "ghcr.io/example/images",
          runtime_api_url: "https://backend.example",
        },
        npm_registry_credential_ids: ["npm-1"],
        container_registry_credential_ids: ["container-1"],
      }),
    )

    const kubeconfig = await file("KUBECONFIG", "kubeconfig")
    const ca = await file("API CA", "api-ca.pem")

    await run(
      "runtime",
      "put",
      "--file",
      path,
      "--kubeconfig-file",
      kubeconfig,
      "--runtime-api-ca-bundle-file",
      ca,
    )

    expect(client.putContainerRuntime).toHaveBeenCalledWith({
      runtime: expect.objectContaining({
        npmRegistryCredentialIds: ["npm-1"],
        containerRegistryCredentialIds: ["container-1"],
        spec: expect.objectContaining({
          imageRepository: "ghcr.io/example/images",
          runtimeApiCaBundle: Buffer.from("API CA"),
          runtime: {
            case: "kubernetes",
            value: expect.objectContaining({
              kubeconfig: Buffer.from("KUBECONFIG"),
              namespace: "highstate",
              serviceAccount: "worker",
              context: "production",
            }),
          },
        }),
      }),
      expectedRevision: undefined,
    })
  })

  it("does not echo malformed secret document values in parse errors", async () => {
    const path = await file('{"credentials":"DO-NOT-ECHO-THIS!"}')
    await run("npm-registry-credential", "put", "--file", path)
    expect(stderr).toContain("Invalid settings document")
    expect(stdout + stderr).not.toContain("DO-NOT-ECHO-THIS")
    expect(client.putNpmRegistryCredential).not.toHaveBeenCalled()
  })

  it("checks runtime readiness with the requested probe and returns nonzero for failures", async () => {
    client.checkContainerRuntime.mockResolvedValue(
      create(CheckContainerRuntimeResponseSchema, {
        ready: false,
        checks: [{ name: "runtime-api", passed: false, message: "Workloads cannot reach backend" }],
      }),
    )

    expect(await run("runtime", "check", "runtime-1", "--probe")).toBe(1)

    expect(client.checkContainerRuntime).toHaveBeenCalledWith({
      containerRuntimeId: "runtime-1",
      probeRuntimeApi: true,
    })

    expect(JSON.parse(stdout).checks[0].message).toBe("Workloads cannot reach backend")

    client.checkContainerRuntime.mockResolvedValue(
      create(CheckContainerRuntimeResponseSchema, { ready: true }),
    )

    expect(await run("runtime", "check", "runtime-1")).toBe(0)

    expect(client.checkContainerRuntime).toHaveBeenLastCalledWith({
      containerRuntimeId: "runtime-1",
      probeRuntimeApi: false,
    })
  })
})

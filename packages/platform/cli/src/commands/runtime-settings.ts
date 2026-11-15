import type { Client } from "@connectrpc/connect"
import { readFile } from "node:fs/promises"
import { type DescMessage, fromJson, type JsonObject, type MessageShape } from "@bufbuild/protobuf"
import {
  CheckContainerRuntimeResponseSchema,
  ContainerRegistryCredentialSchema,
  ContainerRuntimeSchema,
  NpmRegistryCredentialSchema,
  PulumiStateBackendSchema,
  type RuntimeSettingsService,
} from "@highstate/api/v1"
import { Command, Option } from "clipanion"
import { humanTable, messageJson, readDocument } from "../shared/remote"
import { RemoteCommand } from "./remote"

type SettingsClient = Client<typeof RuntimeSettingsService>

interface SettingsResource {
  name: string
  collection: string
  singular: string
  list(client: SettingsClient): Promise<JsonObject[]>
  put(client: SettingsClient, document: JsonObject, revision?: bigint): Promise<unknown>
  delete(client: SettingsClient, id: string, revision: bigint): Promise<unknown>
}

function resource<Desc extends DescMessage>(options: {
  name: string
  collection: string
  singular: string
  schema: Desc
  list(client: SettingsClient): Promise<MessageShape<Desc>[]>
  put(
    client: SettingsClient,
    value: MessageShape<Desc>,
    revision?: bigint,
  ): Promise<MessageShape<Desc> | undefined>
  delete(client: SettingsClient, id: string, revision: bigint): Promise<unknown>
}): SettingsResource {
  return {
    ...options,
    async list(client) {
      return (await options.list(client)).map(
        value => redact(messageJson(options.schema, value)) as JsonObject,
      )
    },
    async put(client, document, revision) {
      let value: MessageShape<Desc>

      try {
        value = fromJson(options.schema, document)
      } catch (error) {
        // protobuf diagnostics can contain the invalid input, including secret material
        throw new Error(
          "Invalid settings document; use protobuf JSON field names and base64 for bytes",
          { cause: error },
        )
      }

      const saved = await options.put(client, value, revision)
      return { [options.singular]: saved ? redact(messageJson(options.schema, saved)) : null }
    },
  }
}

const runtime = resource({
  name: "runtime",
  collection: "runtimes",
  singular: "runtime",
  schema: ContainerRuntimeSchema,
  list: async client => (await client.listContainerRuntimes({})).runtimes,
  put: async (client, value, expectedRevision) =>
    (await client.putContainerRuntime({ runtime: value, expectedRevision })).runtime,
  delete: async (client, containerRuntimeId, expectedRevision) =>
    await client.deleteContainerRuntime({ containerRuntimeId, expectedRevision }),
})

const pulumi = resource({
  name: "pulumi-state-backend",
  collection: "backends",
  singular: "backend",
  schema: PulumiStateBackendSchema,
  list: async client => (await client.listPulumiStateBackends({})).backends,
  put: async (client, value, expectedRevision) =>
    (await client.putPulumiStateBackend({ backend: value, expectedRevision })).backend,
  delete: async (client, pulumiStateBackendId, expectedRevision) =>
    await client.deletePulumiStateBackend({ pulumiStateBackendId, expectedRevision }),
})

const npm = resource({
  name: "npm-registry-credential",
  collection: "credentials",
  singular: "credential",
  schema: NpmRegistryCredentialSchema,
  list: async client => (await client.listNpmRegistryCredentials({})).credentials,
  put: async (client, value, expectedRevision) =>
    (await client.putNpmRegistryCredential({ credential: value, expectedRevision })).credential,
  delete: async (client, npmRegistryCredentialId, expectedRevision) =>
    await client.deleteNpmRegistryCredential({ npmRegistryCredentialId, expectedRevision }),
})

const container = resource({
  name: "container-registry-credential",
  collection: "credentials",
  singular: "credential",
  schema: ContainerRegistryCredentialSchema,
  list: async client => (await client.listContainerRegistryCredentials({})).credentials,
  put: async (client, value, expectedRevision) =>
    (await client.putContainerRegistryCredential({ credential: value, expectedRevision }))
      .credential,
  delete: async (client, containerRegistryCredentialId, expectedRevision) =>
    await client.deleteContainerRegistryCredential({
      containerRegistryCredentialId,
      expectedRevision,
    }),
})

const secretFields = new Set([
  "credentials",
  "kubeconfig",
  "ca_bundle",
  "caBundle",
  "client_certificate",
  "clientCertificate",
  "client_key",
  "clientKey",
])

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact)
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) =>
        secretFields.has(key) && !Array.isArray(entry) ? [] : [[key, redact(entry)]],
      ),
    )
  }

  return value
}

function omitBlankSecrets(value: JsonObject): void {
  for (const [key, entry] of Object.entries(value)) {
    if (
      secretFields.has(key) &&
      (entry === null ||
        (typeof entry === "string" &&
          (!entry.trim() ||
            (/^[A-Za-z0-9+/=_-]+$/.test(entry) &&
              Buffer.from(entry, "base64").length > 0 &&
              !Buffer.from(entry, "base64").toString("utf8").trim()))))
    ) {
      delete value[key]
    } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      omitBlankSecrets(entry)
    }
  }
}

function expectedRevision(value: string | undefined, required: boolean): bigint | undefined {
  if (value === undefined && !required) {
    return undefined
  }

  if (value === undefined || !/^[0-9]+$/.test(value)) {
    throw new Error("An explicit --expected-revision integer is required for existing settings")
  }

  const revision = BigInt(value)
  if (revision > 18446744073709551615n || (required && revision === 0n)) {
    throw new Error("Expected revision must be a positive uint64 for existing settings")
  }

  return revision
}

function object(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Settings document must be an object")
  }

  return value as JsonObject
}

function child(parent: JsonObject, key: string): JsonObject {
  const value = parent[key] ?? {}
  parent[key] = object(value)
  return parent[key] as JsonObject
}

abstract class SettingsCommand extends RemoteCommand {
  abstract resource: SettingsResource
}

abstract class SettingsListCommand extends SettingsCommand {
  async execute(): Promise<void> {
    const { clients } = await this.remote(false)
    const values = await this.resource.list(clients.runtimeSettings)

    this.print(
      { [this.resource.collection]: values },
      humanTable(
        ["ID", "TITLE", "REVISION"],
        values.map(value => [
          value.id,
          (value.meta as JsonObject | undefined)?.title,
          value.revision ?? "0",
        ]),
        "No settings",
      ),
    )
  }
}

abstract class SettingsGetCommand extends SettingsCommand {
  id = Option.String({ required: true })

  async execute(): Promise<void> {
    const { clients } = await this.remote(false)

    const value = (await this.resource.list(clients.runtimeSettings)).find(
      value => value.id === this.id,
    )

    if (!value) {
      throw new Error(`Setting "${this.id}" not found`)
    }

    this.print({ [this.resource.singular]: value })
  }
}

abstract class SettingsPutCommand extends SettingsCommand {
  id = Option.String({ required: false })
  file = Option.String("--file,-f", { required: true })
  revision = Option.String("--expected-revision")
  private stdinUsed = false

  protected async secret(
    document: JsonObject,
    field: string,
    path: string | undefined,
  ): Promise<void> {
    if (path === undefined) {
      return
    }

    if (path === "-" && this.stdinUsed) {
      throw new Error("Stdin may only be used for one input")
    }

    this.stdinUsed ||= path === "-"
    const bytes = path === "-" ? Buffer.from(await Bun.stdin.arrayBuffer()) : await readFile(path)
    if (bytes.toString("utf8").trim()) {
      document[field] = bytes.toString("base64")
    } else {
      delete document[field]
    }
  }

  protected async prepare(_document: JsonObject): Promise<void> {}

  async execute(): Promise<void> {
    this.stdinUsed = this.file === "-"
    let input: unknown

    try {
      input = await readDocument(this.file)
    } catch (error) {
      throw new Error("Failed to read settings document", { cause: error })
    }

    const document = object(input)
    if (this.id && document.id && document.id !== this.id) {
      throw new Error("Document ID does not match the requested setting")
    }

    document.id = this.id ?? document.id ?? ""

    if (typeof document.id !== "string") {
      throw new Error("Setting ID must be a string")
    }

    const action = this.path.at(-1)
    if (action === "create" && document.id) {
      throw new Error("Create requires an empty setting ID")
    }

    if (action === "update" && !document.id) {
      throw new Error("Update requires a setting ID")
    }

    const revision = expectedRevision(this.revision, Boolean(document.id))
    if (!document.id && revision !== undefined && revision !== 0n) {
      throw new Error("Create requires an omitted or zero expected revision")
    }

    await this.prepare(document)
    omitBlankSecrets(document)
    const { clients } = await this.remote(false)
    this.print(await this.resource.put(clients.runtimeSettings, document, revision))
  }
}

abstract class CredentialPutCommand extends SettingsPutCommand {
  credentialsFile = Option.String("--credentials-file")

  protected override async prepare(document: JsonObject): Promise<void> {
    await this.secret(document, "credentials", this.credentialsFile)
  }
}

abstract class SettingsDeleteCommand extends SettingsCommand {
  id = Option.String({ required: true })
  revision = Option.String("--expected-revision", { required: true })

  async execute(): Promise<void> {
    const revision = expectedRevision(this.revision, true)!
    const { clients } = await this.remote(false)
    await this.resource.delete(clients.runtimeSettings, this.id, revision)
    this.print({ id: this.id, deleted: true }, `Deleted ${this.resource.name} "${this.id}"`)
  }
}

export class RuntimeListCommand extends SettingsListCommand {
  static paths = [["runtime", "list"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Lists container runtimes.",
  })

  resource = runtime
}

export class RuntimeGetCommand extends SettingsGetCommand {
  static paths = [["runtime", "get"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Gets a container runtime.",
  })

  resource = runtime
}

export class RuntimePutCommand extends SettingsPutCommand {
  static paths = [
    ["runtime", "put"],
    ["runtime", "create"],
    ["runtime", "update"],
  ]

  static usage = Command.Usage({
    category: "Backend API",
    description:
      "Creates or replaces a runtime from a JSON/YAML file (use - for stdin). Existing IDs require --expected-revision.",
  })

  resource = runtime
  kubeconfigFile = Option.String("--kubeconfig-file")
  dockerCaBundleFile = Option.String("--docker-ca-bundle-file")
  dockerClientCertificateFile = Option.String("--docker-client-certificate-file")
  dockerClientKeyFile = Option.String("--docker-client-key-file")
  runtimeApiCaBundleFile = Option.String("--runtime-api-ca-bundle-file")

  protected override async prepare(document: JsonObject): Promise<void> {
    const spec = child(document, "spec")

    const dockerFiles = [
      this.dockerCaBundleFile,
      this.dockerClientCertificateFile,
      this.dockerClientKeyFile,
    ]

    if (
      this.kubeconfigFile !== undefined &&
      (spec.docker !== undefined || dockerFiles.some(path => path !== undefined))
    ) {
      throw new Error("Kubeconfig input requires a Kubernetes runtime")
    }

    if (dockerFiles.some(path => path !== undefined) && spec.kubernetes !== undefined) {
      throw new Error("Docker TLS input requires a Docker runtime")
    }

    if (this.kubeconfigFile !== undefined) {
      await this.secret(child(spec, "kubernetes"), "kubeconfig", this.kubeconfigFile)
    }

    if (dockerFiles.some(path => path !== undefined)) {
      const tls = child(child(spec, "docker"), "tls")
      await this.secret(tls, "ca_bundle", this.dockerCaBundleFile)
      await this.secret(tls, "client_certificate", this.dockerClientCertificateFile)
      await this.secret(tls, "client_key", this.dockerClientKeyFile)
    }

    await this.secret(spec, "runtime_api_ca_bundle", this.runtimeApiCaBundleFile)
  }
}

export class RuntimeDeleteCommand extends SettingsDeleteCommand {
  static paths = [["runtime", "delete"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Deletes an unused runtime at its expected revision.",
  })

  resource = runtime
}

export class RuntimeCheckCommand extends RemoteCommand {
  static paths = [["runtime", "check"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Checks runtime readiness and optionally probes workload connectivity.",
  })

  id = Option.String({ required: true })
  probe = Option.Boolean("--probe,--probe-runtime-api", false)

  async execute(): Promise<number> {
    const { clients } = await this.remote(false)

    const response = await clients.runtimeSettings.checkContainerRuntime({
      containerRuntimeId: this.id,
      probeRuntimeApi: this.probe,
    })

    this.print(messageJson(CheckContainerRuntimeResponseSchema, response))
    return response.ready ? 0 : 1
  }
}

export class PulumiStateBackendListCommand extends SettingsListCommand {
  static paths = [["pulumi-state-backend", "list"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Lists Pulumi state backends.",
  })

  resource = pulumi
}

export class PulumiStateBackendGetCommand extends SettingsGetCommand {
  static paths = [["pulumi-state-backend", "get"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Gets a Pulumi state backend.",
  })

  resource = pulumi
}

export class PulumiStateBackendPutCommand extends CredentialPutCommand {
  static paths = [
    ["pulumi-state-backend", "put"],
    ["pulumi-state-backend", "create"],
    ["pulumi-state-backend", "update"],
  ]

  static usage = Command.Usage({
    category: "Backend API",
    description:
      "Creates or replaces a Pulumi state backend from JSON/YAML. Credentials are read from the document or --credentials-file; - reads stdin.",
  })

  resource = pulumi
  clearCredentials = Option.Boolean("--clear-credentials", false)

  protected override async prepare(document: JsonObject): Promise<void> {
    await super.prepare(document)

    if (this.clearCredentials) {
      document.clear_credentials = true
    }
  }
}

export class PulumiStateBackendDeleteCommand extends SettingsDeleteCommand {
  static paths = [["pulumi-state-backend", "delete"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Deletes an unused Pulumi state backend at its expected revision.",
  })

  resource = pulumi
}

export class NpmRegistryCredentialListCommand extends SettingsListCommand {
  static paths = [["npm-registry-credential", "list"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Lists npm registry credentials without secrets.",
  })

  resource = npm
}

export class NpmRegistryCredentialGetCommand extends SettingsGetCommand {
  static paths = [["npm-registry-credential", "get"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Gets an npm registry credential without secrets.",
  })

  resource = npm
}

export class NpmRegistryCredentialPutCommand extends CredentialPutCommand {
  static paths = [
    ["npm-registry-credential", "put"],
    ["npm-registry-credential", "create"],
    ["npm-registry-credential", "update"],
  ]

  static usage = Command.Usage({
    category: "Backend API",
    description:
      "Creates or replaces npm registry credentials from JSON/YAML. Use --credentials-file for raw secret bytes; - reads stdin.",
  })

  resource = npm
}

export class NpmRegistryCredentialDeleteCommand extends SettingsDeleteCommand {
  static paths = [["npm-registry-credential", "delete"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Deletes an unused npm registry credential at its expected revision.",
  })

  resource = npm
}

export class ContainerRegistryCredentialListCommand extends SettingsListCommand {
  static paths = [["container-registry-credential", "list"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Lists container registry credentials without secrets.",
  })

  resource = container
}

export class ContainerRegistryCredentialGetCommand extends SettingsGetCommand {
  static paths = [["container-registry-credential", "get"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Gets a container registry credential without secrets.",
  })

  resource = container
}

export class ContainerRegistryCredentialPutCommand extends CredentialPutCommand {
  static paths = [
    ["container-registry-credential", "put"],
    ["container-registry-credential", "create"],
    ["container-registry-credential", "update"],
  ]

  static usage = Command.Usage({
    category: "Backend API",
    description:
      "Creates or replaces container registry credentials from JSON/YAML. Use --credentials-file for raw secret bytes; - reads stdin.",
  })

  resource = container
}

export class ContainerRegistryCredentialDeleteCommand extends SettingsDeleteCommand {
  static paths = [["container-registry-credential", "delete"]]

  static usage = Command.Usage({
    category: "Backend API",
    description: "Deletes an unused container registry credential at its expected revision.",
  })

  resource = container
}

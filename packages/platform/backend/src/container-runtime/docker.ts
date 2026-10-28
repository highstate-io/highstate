import type {
  ContainerRuntimeAdapter,
  ImageBuildRequest,
  ImageIdentity,
  NativeWorkload,
  RegistryCredential,
  RuntimeCapabilities,
  RuntimeFile,
  RuntimeLog,
  RuntimeOwnership,
  RuntimeSession,
  RuntimeVolume,
  WorkloadIntent,
} from "./contracts"
import { Duplex, Readable } from "node:stream"
import Docker from "dockerode"
import { archiveFiles } from "./archive"
import { RuntimeBuildTasks } from "./build-tasks"
import { abortable, delay, ownershipLabels, throwIfAborted } from "./contracts"
import { openDockerBuildSession } from "./docker-build-session"
import { dockerHijack } from "./docker-connection"
import { buildTag, snapshotBuildFiles } from "./image-build"
import { workloadFingerprint } from "./intent"
import { RuntimePlacementQueue } from "./placement-queue"
import { ImageRegistry } from "./registry"

export type DockerRuntimeConfig = {
  endpoint: string
  local: boolean
  tls?: { ca?: string; cert?: string; key?: string }
  apiVersion?: string
  secretHelperImage?: string
  registryCredentials?: RegistryCredential[]
  allowHttpRegistry?: boolean
}

export function createDockerClient(config: DockerRuntimeConfig): Docker {
  const version = config.apiVersion ?? "v1.45"
  if (config.endpoint.startsWith("unix://"))
    return new Docker({ socketPath: config.endpoint.slice(7), version })
  const url = new URL(config.endpoint.replace(/^tcp:/, config.tls ? "https:" : "http:"))
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Unsupported Docker engine endpoint")
  return new Docker({
    host: url.hostname,
    port: Number(url.port || (url.protocol === "https:" ? 2376 : 2375)),
    protocol: url.protocol === "https:" ? "https" : "http",
    version,
    ...config.tls,
  })
}

function missing(error: unknown): boolean {
  return (error as { statusCode?: number }).statusCode === 404
}
function filters(labels: Record<string, string>): string {
  return JSON.stringify({ label: Object.entries(labels).map(([key, value]) => `${key}=${value}`) })
}
function authFor(
  image: string,
  credentials: RegistryCredential[] = [],
): RegistryCredential | undefined {
  const first = image.split("/")[0] ?? ""
  const registry =
    first.includes(".") || first.includes(":") || first === "localhost" ? first : "docker.io"
  return credentials.find(
    credential =>
      credential.serveraddress.replace(/^https?:\/\//, "").replace(/\/$/, "") === registry,
  )
}

export class DockerRuntimeAdapter implements ContainerRuntimeAdapter {
  private readonly placements = new RuntimePlacementQueue()
  readonly capabilities: RuntimeCapabilities
  private readonly builds = new RuntimeBuildTasks()

  constructor(
    private readonly config: DockerRuntimeConfig,
    private readonly client: Docker = createDockerClient(config),
  ) {
    this.capabilities = {
      build: true,
      push: true,
      localImages: config.local,
      localOverlay: config.local,
      attach: true,
      exec: true,
      networking: true,
      persistentVolumes: true,
    }
  }

  async preflight(signal?: AbortSignal) {
    await abortable(this.client.ping(), signal)
    const info = await abortable(this.client.info(), signal)
    return [
      { name: "engine", ok: true, detail: info.ServerVersion },
      {
        name: "local-overlay",
        ok: this.config.local,
        detail: this.config.local
          ? "Daemon-local bind mounts enabled"
          : "Remote daemon cannot mount backend paths",
      },
    ]
  }

  private async consume(
    stream: NodeJS.ReadableStream,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    const close = () =>
      (stream as Duplex).destroy(
        signal?.reason instanceof Error ? signal.reason : new Error("Aborted"),
      )
    signal?.addEventListener("abort", close, { once: true })
    try {
      return await abortable(
        new Promise<Record<string, unknown>[]>((resolve, reject) => {
          this.client.modem.followProgress(stream, (error, output) => {
            if (error) return reject(error)
            const events = output as Record<string, unknown>[]
            const failure = events.find(event => event.error)
            if (failure) return reject(new Error(String(failure.error)))
            resolve(events)
          })
        }),
        signal,
      )
    } finally {
      signal?.removeEventListener("abort", close)
    }
  }

  async ensureImage(
    reference: string,
    credentials?: RegistryCredential[],
    signal?: AbortSignal,
  ): Promise<ImageIdentity> {
    throwIfAborted(signal)
    try {
      return await this.imageIdentity(reference)
    } catch (error) {
      if (!missing(error)) throw error
    }
    const stream = await this.client.pull(reference, {
      authconfig: authFor(reference, credentials ?? this.config.registryCredentials),
    })
    await this.consume(stream, signal)
    return await this.imageIdentity(reference)
  }

  private async imageIdentity(reference: string): Promise<ImageIdentity> {
    const image = await this.client.getImage(reference).inspect()
    const repoDigest = image.RepoDigests?.find(item => item.includes("@sha256:"))
    if (reference.includes("@") && !image.RepoDigests?.includes(reference))
      throw new Error("Docker image digest does not match requested reference")
    return {
      reference: repoDigest ?? image.Id,
      digest: repoDigest?.split("@")[1] ?? image.Id,
      imageHash: image.Config.Labels?.["highstate.io/snapshot-hash"] ?? "",
    }
  }

  async verifyImage(image: ImageIdentity, signal?: AbortSignal): Promise<boolean> {
    throwIfAborted(signal)
    try {
      const actual = await this.imageIdentity(image.reference)
      return actual.digest === image.digest && actual.imageHash === image.imageHash
    } catch (error) {
      if (missing(error)) return false
      throw error
    }
  }

  async buildImage(
    request: ImageBuildRequest,
    progress: (phase: "installing" | "building" | "pushing" | "verifying") => Promise<void>,
    signal?: AbortSignal,
  ): Promise<ImageIdentity> {
    return await this.builds.run(
      request.owner.workloadId,
      async signal => await this.build(request, progress, signal),
      signal,
    )
  }

  private async build(
    request: ImageBuildRequest,
    progress: (phase: "installing" | "building" | "pushing" | "verifying") => Promise<void>,
    signal: AbortSignal,
  ): Promise<ImageIdentity> {
    if (!this.config.local && !request.repository)
      throw new Error("Remote Docker image builds require an image repository")
    const files = snapshotBuildFiles(request)
    const tag = buildTag(request)
    await progress("installing")
    const context = await archiveFiles(files)
    const session = await openDockerBuildSession(this.config, request, signal)
    try {
      // bypass Dockerode's Node-only automatic upgrade helper; the context still uses the engine build API
      const stream = await new Promise<Readable>((resolve, reject) => {
        this.client.modem.dial(
          {
            path: "/build?",
            method: "POST",
            isStream: true,
            file: Readable.from([context]),
            options: {
              t: tag,
              version: "2",
              session: session.id,
              labels: JSON.stringify(ownershipLabels(request.owner)),
              platform: request.platforms?.join(","),
            },
            statusCodes: { 200: true, 500: "Build failed" },
          },
          (error, stream) => (error ? reject(error) : resolve(stream as Readable)),
        )
      })
      await progress("building")
      await this.consume(stream, signal)
    } finally {
      session.close()
    }
    if (request.repository) {
      await progress("pushing")
      const stream = await this.client.getImage(tag).push({
        authconfig:
          authFor(tag, request.registryCredentials ?? this.config.registryCredentials) ?? {},
      })
      await this.consume(stream, signal)
    }
    await progress("verifying")
    const identity = request.repository
      ? await new ImageRegistry({
          credentials: request.registryCredentials ?? this.config.registryCredentials,
          allowHttp: this.config.allowHttpRegistry,
        }).inspect(tag, signal)
      : await this.imageIdentity(tag)
    if (identity.imageHash !== request.snapshotHash)
      throw new Error("Built image snapshot hash mismatch")
    if (request.repository && !identity.reference.includes("@sha256:"))
      throw new Error("Pushed image has no immutable registry digest")
    return identity
  }

  async createEnvironment(owner: RuntimeOwnership, signal?: AbortSignal) {
    throwIfAborted(signal)
    const name = `hs-${owner.workloadId}-${owner.generation}`
    const existing = await this.client.listNetworks({ filters: filters(ownershipLabels(owner)) })
    if (existing[0]) return { id: existing[0].Id, owner }
    const network = await this.client.createNetwork({
      Name: name,
      Driver: "bridge",
      Labels: ownershipLabels(owner),
      CheckDuplicate: true,
    })
    return { id: (network as unknown as Docker.Network).id, owner }
  }

  async place(intent: WorkloadIntent, signal?: AbortSignal): Promise<NativeWorkload> {
    return await this.placements.run(
      intent.environment?.id ?? intent.owner.workloadId,
      async () => await this.placeNative(intent, signal),
      signal,
    )
  }

  private async placeNative(intent: WorkloadIntent, signal?: AbortSignal): Promise<NativeWorkload> {
    throwIfAborted(signal)
    if (intent.localBinds?.length && !this.config.local)
      throw new Error("Remote Docker cannot mount backend-host paths")
    const labels = {
      ...ownershipLabels(intent.owner),
      "highstate.io/intent": workloadFingerprint(intent),
    }
    const existing = await this.discover(ownershipLabels(intent.owner), signal)
    if (existing[0]) {
      if (existing[0].labels["highstate.io/intent"] !== labels["highstate.io/intent"])
        throw new Error("Workload declaration changed within one generation")
      return existing[0]
    }
    if (intent.aliases?.length) {
      if (!intent.environment) throw new Error("Sidecar aliases require an operation environment")
      const network = await this.client.getNetwork(intent.environment.id).inspect()
      for (const id of Object.keys(network.Containers ?? {})) {
        const container = await this.client.getContainer(id).inspect()
        for (const attachment of Object.values(container.NetworkSettings.Networks)) {
          if (
            attachment.NetworkID === network.Id &&
            (attachment.Aliases as string[] | undefined)?.some(alias =>
              intent.aliases!.includes(alias),
            )
          )
            throw new Error("Sidecar alias already belongs to another workload")
        }
      }
    }
    await this.ensureImage(intent.image, undefined, signal)
    const mounts: Docker.MountSettings[] = []
    for (const volume of intent.volumes ?? []) {
      await this.ensureVolume(intent.owner, volume, signal)
      mounts.push({ Type: "volume", Source: volume.name, Target: volume.mountPath })
    }
    const secrets = intent.files?.filter(file => file.secret) ?? []
    if (secrets.length) {
      if (secrets.some(file => !file.path.replace(/^\//, "").startsWith("run/highstate/")))
        throw new Error("Docker secret files must be under /run/highstate")
      const volume = `hs-secret-${intent.owner.workloadId}-${intent.owner.generation}`
      await this.client.createVolume({
        Name: volume,
        Labels: { ...labels, "highstate.io/ephemeral": "true" },
      })
      mounts.push({ Type: "volume", Source: volume, Target: "/run/highstate" })
      const helperImage = this.config.secretHelperImage ?? "busybox:1.37"
      await this.ensureImage(helperImage, undefined, signal)
      const helper = await this.client.createContainer({
        Image: helperImage,
        Cmd: ["true"],
        Labels: { ...labels, "highstate.io/helper": "true" },
        HostConfig: { Mounts: [{ Type: "volume", Source: volume, Target: "/run/highstate" }] },
      })
      try {
        await helper.putArchive(await archiveFiles(secrets), { path: "/" })
      } finally {
        await helper.remove({ force: true })
      }
    }
    const container = await this.client.createContainer({
      name: `hs-${intent.owner.workloadId}-${intent.owner.generation}`,
      Image: intent.image,
      Entrypoint: intent.command,
      Cmd: intent.args,
      Env: Object.entries(intent.env ?? {}).map(([key, value]) => `${key}=${value}`),
      WorkingDir: intent.workingDir,
      Tty: intent.tty,
      OpenStdin: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Labels: labels,
      User: intent.rootlessBuilder ? "1000:1000" : undefined,
      HostConfig: {
        ExtraHosts: this.config.local ? ["host.docker.internal:host-gateway"] : undefined,
        SecurityOpt: intent.rootlessBuilder
          ? ["seccomp=unconfined", "apparmor=unconfined"]
          : undefined,
        Mounts: [
          ...mounts,
          ...(intent.localBinds ?? []).map(bind => ({
            Type: "bind" as const,
            Source: bind.source,
            Target: bind.target,
            ReadOnly: bind.readOnly,
          })),
        ],
      },
      NetworkingConfig: intent.environment
        ? { EndpointsConfig: { [intent.environment.id]: { Aliases: intent.aliases } } }
        : undefined,
    })
    await this.putFiles(container.id, intent.files?.filter(file => !file.secret) ?? [], signal)
    await container.start()
    return await this.inspect(container.id, signal)
  }

  async inspect(id: string, signal?: AbortSignal): Promise<NativeWorkload> {
    throwIfAborted(signal)
    try {
      const value = await this.client.getContainer(id).inspect()
      return {
        id,
        labels: value.Config.Labels,
        state: value.State.Running
          ? "running"
          : value.State.Status === "created"
            ? "pending"
            : value.State.ExitCode === 0
              ? "completed"
              : "failed",
        exitCode: value.State.ExitCode,
      }
    } catch (error) {
      if (missing(error)) return { id, labels: {}, state: "missing" }
      throw error
    }
  }

  async discover(labels: Record<string, string>, signal?: AbortSignal): Promise<NativeWorkload[]> {
    throwIfAborted(signal)
    const containers = await this.client.listContainers({ all: true, filters: filters(labels) })
    return await Promise.all(
      containers
        .filter(container => container.Labels["highstate.io/helper"] !== "true")
        .map(container => this.inspect(container.Id, signal)),
    )
  }

  async discoverResources(labels: Record<string, string>, signal?: AbortSignal) {
    throwIfAborted(signal)
    const query = { filters: filters(labels) }
    const [containers, networks, volumes] = await Promise.all([
      this.client.listContainers({ ...query, all: true }),
      this.client.listNetworks(query),
      this.client.listVolumes(query),
    ])
    return [
      ...containers.map(item => ({ id: item.Id, type: "container", labels: item.Labels })),
      ...networks.map(item => ({ id: item.Id, type: "network", labels: item.Labels ?? {} })),
      ...(volumes.Volumes ?? []).map(item => ({
        id: item.Name,
        type: "volume",
        labels: item.Labels ?? {},
      })),
    ]
  }

  async ensureVolume(
    owner: RuntimeOwnership,
    volume: RuntimeVolume,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal)
    await this.client.createVolume({ Name: volume.name, Labels: ownershipLabels(owner) })
    const native = await this.client.getVolume(volume.name).inspect()
    this.assertVolumeOwner(owner, native.Labels ?? {})
  }

  private assertVolumeOwner(owner: RuntimeOwnership, labels: Record<string, string>) {
    if (
      labels["highstate.io/backend"] !== owner.backendId ||
      labels["highstate.io/project"] !== owner.projectId ||
      labels["highstate.io/runtime"] !== owner.runtimeId
    )
      throw new Error("Managed volume belongs to another owner")
  }

  async removeVolume(owner: RuntimeOwnership, name: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    try {
      const volume = this.client.getVolume(name)
      this.assertVolumeOwner(owner, (await volume.inspect()).Labels ?? {})
      await volume.remove()
    } catch (error) {
      if (!missing(error)) throw error
    }
  }

  async stop(id: string, force = false, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    try {
      if (force) await this.client.getContainer(id).kill()
      else await this.client.getContainer(id).stop({ t: 10 })
    } catch (error) {
      if (
        !missing(error) &&
        (error as { statusCode?: number }).statusCode !== 304 &&
        (error as { statusCode?: number }).statusCode !== 409
      )
        throw error
    }
  }

  async cleanup(owner: RuntimeOwnership, signal?: AbortSignal): Promise<void> {
    await this.builds.cancel(owner.workloadId)
    const labels = ownershipLabels(owner)
    delete labels["highstate.io/generation"]
    const selector = filters(labels)
    // retain all failed children for the next reconciliation attempt
    const containers = await this.client.listContainers({ all: true, filters: selector })
    for (const container of containers) {
      throwIfAborted(signal)
      try {
        await this.client.getContainer(container.Id).remove({ force: true, v: true })
      } catch (error) {
        if (!missing(error)) throw error
      }
    }
    for (const network of await this.client.listNetworks({ filters: selector })) {
      try {
        await this.client.getNetwork(network.Id).remove()
      } catch (error) {
        if (!missing(error)) throw error
      }
    }
    const volumes = await this.client.listVolumes({ filters: selector })
    for (const volume of volumes.Volumes ?? []) {
      if (volume.Labels?.["highstate.io/ephemeral"] !== "true") continue
      try {
        await this.client.getVolume(volume.Name).remove()
      } catch (error) {
        if (!missing(error)) throw error
      }
    }
  }

  async putFiles(id: string, files: RuntimeFile[], signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    if (files.length)
      await this.client.getContainer(id).putArchive(await archiveFiles(files), { path: "/" })
  }

  private session(
    stream: Duplex,
    resize: (columns: number, rows: number) => Promise<unknown>,
    completed: Promise<number | undefined>,
    signal?: AbortSignal,
  ): RuntimeSession {
    const close = () => stream.destroy()
    signal?.addEventListener("abort", close, { once: true })
    stream.once("close", () => signal?.removeEventListener("abort", close))
    return {
      stream,
      resize: async (columns, rows) => {
        await resize(columns, rows)
      },
      close,
      completed,
    }
  }

  async attach(id: string, signal?: AbortSignal): Promise<RuntimeSession> {
    throwIfAborted(signal)
    const container = this.client.getContainer(id)
    const stream = await dockerHijack(
      this.config,
      `/containers/${encodeURIComponent(id)}/attach?stream=1&stdin=1&stdout=1&stderr=1`,
      undefined,
      signal,
    )
    const tty = (await container.inspect()).Config.Tty
    return this.session(
      this.interactiveStream(stream, tty),
      (columns, rows) => container.resize({ w: columns, h: rows }),
      new Promise<undefined>(resolve => stream.once("close", () => resolve(undefined))),
      signal,
    )
  }

  async exec(
    id: string,
    command: string[],
    options?: { tty?: boolean; signal?: AbortSignal },
  ): Promise<RuntimeSession> {
    throwIfAborted(options?.signal)
    const execution = await this.client.getContainer(id).exec({
      Cmd: command,
      Tty: options?.tty,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
    })
    const stream = await dockerHijack(
      this.config,
      `/exec/${encodeURIComponent(execution.id)}/start`,
      { Detach: false, Tty: options?.tty ?? false },
      options?.signal,
    )
    const completed = (async () => {
      for (;;) {
        const value = await execution.inspect()
        if (!value.Running) return value.ExitCode ?? -1
        await delay(100, options?.signal)
      }
    })()
    void completed.catch(() => {})
    return this.session(
      this.interactiveStream(stream, options?.tty ?? false),
      (columns, rows) => execution.resize({ w: columns, h: rows }),
      completed,
      options?.signal,
    )
  }

  private interactiveStream(socket: Duplex, tty: boolean): Duplex {
    async function* output() {
      if (tty) {
        for await (const chunk of socket) yield chunk
        return
      }
      let pending = Buffer.alloc(0)
      for await (const chunk of socket) {
        pending = Buffer.concat([pending, Buffer.from(chunk)])
        while (pending.length >= 8) {
          const size = pending.readUInt32BE(4)
          if (size > 16 * 1024 * 1024) throw new Error("Docker stream frame exceeds limit")
          if (pending.length < size + 8) break
          yield pending.subarray(8, size + 8)
          pending = pending.subarray(size + 8)
        }
      }
      if (pending.length) throw new Error("Truncated Docker stream frame")
    }
    const readable = Readable.from(output(), { objectMode: false })
    const stream = new Duplex({
      read() {
        readable.resume()
      },
      write(chunk, encoding, callback) {
        socket.write(chunk, encoding, callback)
      },
      final(callback) {
        socket.end(callback)
      },
      destroy(error, callback) {
        readable.destroy()
        socket.destroy()
        callback(error)
      },
    })
    readable.on("data", chunk => {
      if (!stream.push(chunk)) readable.pause()
    })
    readable.on("end", () => stream.push(null))
    readable.on("error", error => {
      if (!stream.destroyed) stream.destroy(error)
    })
    socket.on("error", error => {
      if (!stream.destroyed) stream.destroy(error)
    })
    readable.pause()
    return stream
  }

  async *logs(id: string, follow = false, signal?: AbortSignal): AsyncIterable<RuntimeLog> {
    throwIfAborted(signal)
    const container = this.client.getContainer(id)
    const info = await container.inspect()
    const stream = await new Promise<Readable>((resolve, reject) => {
      this.client.modem.dial(
        {
          path: `/containers/${encodeURIComponent(id)}/logs?`,
          method: "GET",
          isStream: true,
          options: { follow, stdout: true, stderr: true },
          statusCodes: { 200: true, 404: "Container not found" },
        },
        (error, stream) => (error ? reject(error) : resolve(stream as Readable)),
      )
    })
    const close = () => stream.destroy()
    signal?.addEventListener("abort", close, { once: true })
    try {
      if (info.Config.Tty) {
        for await (const data of stream) yield { stream: "stdout", data: Buffer.from(data) }
        return
      }
      let pending = Buffer.alloc(0)
      for await (const chunk of stream) {
        pending = Buffer.concat([pending, Buffer.from(chunk)])
        while (pending.length >= 8) {
          const size = pending.readUInt32BE(4)
          if (pending.length < size + 8) break
          yield {
            stream: pending[0] === 2 ? "stderr" : "stdout",
            data: pending.subarray(8, size + 8),
          }
          pending = pending.subarray(size + 8)
        }
      }
    } finally {
      signal?.removeEventListener("abort", close)
      stream.destroy()
    }
  }
}

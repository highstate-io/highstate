import type { Duplex } from "node:stream"

export type WorkloadKind =
  | "pulumi"
  | "composite_evaluation"
  | "library_build"
  | "sidecar"
  | "worker"
  | "terminal"
export type RuntimeOwnership = {
  backendId: string
  projectId: string
  runtimeId: string
  workloadId: string
  kind: WorkloadKind
  operationId?: string
  generation: number
}
export const labelPrefix = "highstate.io/"

export function ownershipLabels(owner: RuntimeOwnership): Record<string, string> {
  if (
    [owner.backendId, owner.projectId, owner.runtimeId, owner.workloadId, owner.kind].some(
      value => typeof value !== "string" || !value,
    ) ||
    !Number.isSafeInteger(owner.generation) ||
    owner.generation < 1
  )
    throw new Error("Invalid runtime resource ownership")
  return Object.fromEntries(
    Object.entries({
      backend: owner.backendId,
      project: owner.projectId,
      runtime: owner.runtimeId,
      workload: owner.workloadId,
      kind: owner.kind,
      operation: owner.operationId,
      generation: String(owner.generation),
    })
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => [`${labelPrefix}${key}`, value]),
  )
}

export type RuntimeCapabilities = {
  build: boolean
  push: boolean
  localImages: boolean
  localOverlay: boolean
  attach: boolean
  exec: boolean
  networking: boolean
  persistentVolumes: boolean
}
export type RuntimeFile = {
  path: string
  data: Uint8Array
  mode?: number
  secret?: boolean
  uid?: number
  gid?: number
}
export type RegistryCredential = { serveraddress: string; username: string; password: string }
export type RuntimeEnvironment = { id: string; owner: RuntimeOwnership }
export type RuntimeVolume = {
  name: string
  mountPath: string
  size?: string
  storageClass?: string
}
export type NativeResource = { id: string; type: string; labels: Record<string, string> }
export type WorkloadIntent = {
  owner: RuntimeOwnership
  image: string
  command?: string[]
  args?: string[]
  env?: Record<string, string>
  files?: RuntimeFile[]
  volumes?: RuntimeVolume[]
  localBinds?: { source: string; target: string; readOnly?: boolean }[]
  environment?: RuntimeEnvironment
  aliases?: string[]
  ports?: { name: string; port: number }[]
  mode?: "pod" | "deployment" | "job"
  tty?: boolean
  workingDir?: string
  imagePullSecrets?: string[]
  rootlessBuilder?: boolean
}
export type NativeWorkload = {
  id: string
  labels: Record<string, string>
  state: "pending" | "running" | "completed" | "failed" | "missing"
  exitCode?: number
}
export type RuntimeLog = { stream: "stdout" | "stderr"; data: Uint8Array }
export interface RuntimeSession {
  readonly stream: Duplex
  resize(columns: number, rows: number): Promise<void>
  close(): void
  /** Resolves to the process exit code for exec, or void for attach. */
  completed: Promise<number | undefined>
}
export type ImageIdentity = { reference: string; digest: string; imageHash: string }
export type ImageBuildPhase = "installing" | "building" | "pushing" | "verifying"
export type ImageBuildRequest = {
  owner: RuntimeOwnership
  snapshotId: string
  snapshotHash: string
  buildGeneration?: number
  baseImage: string
  files: RuntimeFile[]
  platforms?: string[]
  repository?: string
  secrets?: RuntimeFile[]
  registryCredentials?: RegistryCredential[]
}
export type PreflightCheck = { name: string; ok: boolean; detail?: string }
export interface ContainerRuntimeAdapter {
  readonly capabilities: RuntimeCapabilities
  preflight(signal?: AbortSignal): Promise<PreflightCheck[]>
  ensureImage(
    reference: string,
    credentials?: RegistryCredential[],
    signal?: AbortSignal,
  ): Promise<ImageIdentity>
  verifyImage(image: ImageIdentity, signal?: AbortSignal): Promise<boolean>
  buildImage(
    request: ImageBuildRequest,
    progress: (phase: ImageBuildPhase) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<ImageIdentity>
  createEnvironment(owner: RuntimeOwnership, signal?: AbortSignal): Promise<RuntimeEnvironment>
  place(intent: WorkloadIntent, signal?: AbortSignal): Promise<NativeWorkload>
  inspect(id: string, signal?: AbortSignal): Promise<NativeWorkload>
  discover(labels: Record<string, string>, signal?: AbortSignal): Promise<NativeWorkload[]>
  discoverResources(labels: Record<string, string>, signal?: AbortSignal): Promise<NativeResource[]>
  ensureVolume(owner: RuntimeOwnership, volume: RuntimeVolume, signal?: AbortSignal): Promise<void>
  removeVolume(owner: RuntimeOwnership, name: string, signal?: AbortSignal): Promise<void>
  stop(id: string, force?: boolean, signal?: AbortSignal): Promise<void>
  cleanup(owner: RuntimeOwnership, signal?: AbortSignal): Promise<void>
  attach(id: string, signal?: AbortSignal): Promise<RuntimeSession>
  exec(
    id: string,
    command: string[],
    options?: { tty?: boolean; signal?: AbortSignal },
  ): Promise<RuntimeSession>
  logs(id: string, follow?: boolean, signal?: AbortSignal): AsyncIterable<RuntimeLog>
  putFiles(id: string, files: RuntimeFile[], signal?: AbortSignal): Promise<void>
}
export interface RuntimeAdapterProvider {
  get(runtimeId: string): Promise<ContainerRuntimeAdapter>
}

export function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}

export async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  if (!signal) return await promise
  let listener: () => void = () => {}
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        listener = () => reject(signal.reason ?? new Error("Runtime operation aborted"))
        signal.addEventListener("abort", listener, { once: true })
      }),
    ])
  } finally {
    signal.removeEventListener("abort", listener)
  }
}

export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await abortable(
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, ms)
      }),
      signal,
    )
  } finally {
    clearTimeout(timer)
  }
}

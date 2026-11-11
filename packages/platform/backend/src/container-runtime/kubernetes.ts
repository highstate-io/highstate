import type {
  ContainerRuntimeAdapter,
  ImageBuildRequest,
  ImageIdentity,
  NativeWorkload,
  RegistryCredential,
  RuntimeFile,
  RuntimeLog,
  RuntimeOwnership,
  RuntimeSession,
  RuntimeVolume,
  WorkloadIntent,
} from "./contracts"
import { createHash } from "node:crypto"
import { Duplex, PassThrough } from "node:stream"
import * as k8s from "@kubernetes/client-node"
import { archiveFiles } from "./archive"
import { RuntimeBuildTasks } from "./build-tasks"
import { abortable, delay, ownershipLabels, throwIfAborted } from "./contracts"
import { buildTag, snapshotBuildFiles } from "./image-build"
import { workloadFingerprint } from "./intent"
import { RuntimePlacementQueue } from "./placement-queue"
import { ImageRegistry, RegistryResponseError } from "./registry"

export type KubernetesRuntimeConfig = {
  kubeconfig?: string
  context?: string
  namespace: string
  serviceAccount: string
  buildkitImage: string
  clusterDns?: string
  dnsImage?: string
  imagePullSecrets?: string[]
  fileHelperImage?: string
  registryCredentials?: RegistryCredential[]
  allowHttpRegistry?: boolean
}
function statusCode(error: unknown): number | undefined {
  const value = error as { code?: number; statusCode?: number; response?: { statusCode: number } }
  return value.code ?? value.statusCode ?? value.response?.statusCode
}
function selector(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([key, value]) => `${key}=${value}`)
    .join(",")
}
export function nativeName(identity: string): string {
  return `hs-${createHash("sha256").update(identity).digest("hex").slice(0, 40)}`
}
export function operationAliasConfig(aliases: Record<string, string>, clusterDns: string): string {
  const zones = Object.entries(aliases)
    .map(([alias, address]) => {
      if (!/^(?=.{1,253}\.?$)[a-zA-Z0-9_](?:[a-zA-Z0-9_.-]*[a-zA-Z0-9_])?\.?$/.test(alias)) {
        throw new Error(`Invalid sidecar DNS alias "${alias}"`)
      }

      if (!/^[a-fA-F0-9:.]+$/.test(address)) {
        throw new Error("Invalid sidecar service address")
      }

      return `${alias.replace(/\.$/, "")}:53 {\n hosts {\n ${address} ${alias.replace(/\.$/, "")}\n }\n}\n`
    })
    .join("")

  if (!/^[a-fA-F0-9:.]+$/.test(clusterDns)) {
    throw new Error("Invalid cluster DNS address")
  }

  return `${zones}.:53 {\n forward . ${clusterDns}\n cache 5\n reload 2s 1s\n}\n`
}

export class KubernetesRuntimeAdapter implements ContainerRuntimeAdapter {
  private readonly placements = new RuntimePlacementQueue()
  private readonly builds = new RuntimeBuildTasks()
  readonly capabilities = {
    build: true,
    push: true,
    localImages: false,
    localOverlay: false,
    attach: true,
    exec: true,
    networking: true,
    persistentVolumes: true,
  }
  private readonly kubeconfig: k8s.KubeConfig
  private readonly core: k8s.CoreV1Api
  private readonly apps: k8s.AppsV1Api
  private readonly batch: k8s.BatchV1Api
  private readonly registry: ImageRegistry

  constructor(
    private readonly config: KubernetesRuntimeConfig,
    kubeconfig?: k8s.KubeConfig,
  ) {
    this.kubeconfig = kubeconfig ?? new k8s.KubeConfig()

    if (!kubeconfig) {
      if (config.kubeconfig) {
        this.kubeconfig.loadFromString(config.kubeconfig)
      } else {
        this.kubeconfig.loadFromDefault()
      }

      if (config.context) {
        this.kubeconfig.setCurrentContext(config.context)
      }
    }

    this.core = this.kubeconfig.makeApiClient(k8s.CoreV1Api)
    this.apps = this.kubeconfig.makeApiClient(k8s.AppsV1Api)
    this.batch = this.kubeconfig.makeApiClient(k8s.BatchV1Api)

    this.registry = new ImageRegistry({
      credentials: config.registryCredentials,
      allowHttp: config.allowHttpRegistry,
    })
  }

  async preflight(signal?: AbortSignal) {
    throwIfAborted(signal)
    await this.core.readNamespace({ name: this.config.namespace })

    await this.core.readNamespacedServiceAccount({
      namespace: this.config.namespace,
      name: this.config.serviceAccount,
    })

    const authorization = this.kubeconfig.makeApiClient(k8s.AuthorizationV1Api)

    const checks = [
      { name: "namespace", ok: true },
      { name: "service-account", ok: true },
    ]

    for (const [group, resource, verb] of [
      ["", "pods", "create"],
      ["", "pods/exec", "create"],
      ["", "pods/attach", "create"],
      ["", "secrets", "create"],
      ["", "services", "create"],
      ["", "configmaps", "create"],
      ["", "persistentvolumeclaims", "create"],
      ["apps", "deployments", "create"],
      ["batch", "jobs", "create"],
    ]) {
      const review = await authorization.createSelfSubjectAccessReview({
        body: {
          apiVersion: "authorization.k8s.io/v1",
          kind: "SelfSubjectAccessReview",
          spec: { resourceAttributes: { namespace: this.config.namespace, group, resource, verb } },
        },
      })

      checks.push({ name: `${verb}:${resource}`, ok: review.status?.allowed === true })
    }

    return checks
  }

  async ensureImage(
    reference: string,
    credentials?: RegistryCredential[],
    signal?: AbortSignal,
  ): Promise<ImageIdentity> {
    return await (credentials
      ? new ImageRegistry({ credentials, allowHttp: this.config.allowHttpRegistry })
      : this.registry
    ).inspect(reference, signal)
  }

  async verifyImage(image: ImageIdentity, signal?: AbortSignal): Promise<boolean> {
    try {
      const actual = await this.registry.inspect(image.reference, signal)
      return actual.digest === image.digest && actual.imageHash === image.imageHash
    } catch (error) {
      if (error instanceof RegistryResponseError && error.status === 404) {
        return false
      }

      throw error
    }
  }

  private async createOrRead<T>(create: () => Promise<T>, read: () => Promise<T>): Promise<T> {
    try {
      return await create()
    } catch (error) {
      if (statusCode(error) !== 409) {
        throw error
      }

      return await read()
    }
  }

  private async clusterDns(): Promise<string> {
    if (this.config.clusterDns) {
      return this.config.clusterDns
    }

    // read-only discovery; every resource created by this adapter remains namespace-local
    const service = await this.core.readNamespacedService({
      namespace: "kube-system",
      name: "kube-dns",
    })

    if (!service.spec?.clusterIP) {
      throw new Error("Configure clusterDns when kube-dns discovery is unavailable")
    }

    return service.spec.clusterIP
  }

  async createEnvironment(owner: RuntimeOwnership, signal?: AbortSignal) {
    throwIfAborted(signal)
    const name = nativeName(`environment/${owner.workloadId}/${owner.generation}`)
    const namespace = this.config.namespace
    const labels = { ...ownershipLabels(owner), "highstate.io/environment": name }
    const clusterDns = await this.clusterDns()

    await this.createOrRead(
      () =>
        this.core.createNamespacedConfigMap({
          namespace,
          body: {
            metadata: { name, labels, annotations: { "highstate.io/aliases": "{}" } },
            data: { Corefile: operationAliasConfig({}, clusterDns) },
          },
        }),
      () => this.core.readNamespacedConfigMap({ namespace, name }),
    )

    const service = await this.createOrRead(
      () =>
        this.core.createNamespacedService({
          namespace,
          body: {
            metadata: { name, labels },
            spec: {
              selector: { "highstate.io/dns": name },
              ports: [
                { name: "dns-udp", port: 53, protocol: "UDP" },
                { name: "dns-tcp", port: 53, protocol: "TCP" },
              ],
            },
          },
        }),
      () => this.core.readNamespacedService({ namespace, name }),
    )

    await this.createOrRead(
      () =>
        this.core.createNamespacedPod({
          namespace,
          body: {
            metadata: { name, labels: { ...labels, "highstate.io/dns": name } },
            spec: {
              serviceAccountName: this.config.serviceAccount,
              automountServiceAccountToken: false,
              containers: [
                {
                  name: "dns",
                  image: this.config.dnsImage ?? "coredns/coredns:1.12.0",
                  args: ["-conf", "/etc/coredns/Corefile"],
                  volumeMounts: [{ name: "config", mountPath: "/etc/coredns" }],
                },
              ],
              volumes: [{ name: "config", configMap: { name } }],
            },
          },
        }),
      () => this.core.readNamespacedPod({ namespace, name }),
    )

    if (!service.spec?.clusterIP) {
      throw new Error("Operation DNS service has no cluster IP")
    }

    return { id: name, owner }
  }

  private async addAliases(environment: string, aliases: string[], address: string): Promise<void> {
    const namespace = this.config.namespace

    for (let attempt = 0; attempt < 10; attempt++) {
      const config = await this.core.readNamespacedConfigMap({ namespace, name: environment })

      const mapping = JSON.parse(
        config.metadata?.annotations?.["highstate.io/aliases"] ?? "{}",
      ) as Record<string, string>

      for (const alias of aliases) {
        if (mapping[alias] && mapping[alias] !== address) {
          throw new Error(`Sidecar alias "${alias}" already belongs to another workload`)
        }

        mapping[alias] = address
      }

      config.metadata!.annotations = {
        ...config.metadata!.annotations,
        "highstate.io/aliases": JSON.stringify(mapping),
      }

      config.data = { Corefile: operationAliasConfig(mapping, await this.clusterDns()) }

      try {
        await this.core.replaceNamespacedConfigMap({ namespace, name: environment, body: config })
        return
      } catch (error) {
        if (statusCode(error) !== 409) {
          throw error
        }
      }
    }

    throw new Error("Operation DNS configuration remained contested")
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

    if (intent.localBinds?.length) {
      throw new Error("Kubernetes cannot mount backend-host paths")
    }

    const namespace = this.config.namespace
    const name = nativeName(`${intent.owner.workloadId}/${intent.owner.generation}`)

    const labels = {
      ...ownershipLabels(intent.owner),
      "highstate.io/intent": `h${workloadFingerprint(intent)}h`,
    }

    const existing = await this.discover(ownershipLabels(intent.owner), signal)
    if (existing[0]) {
      if (existing[0].labels["highstate.io/intent"] !== labels["highstate.io/intent"]) {
        throw new Error("Workload declaration changed within one generation")
      }

      return existing[0]
    }

    const podLabels = { ...labels, "highstate.io/root": name }
    const mounts: k8s.V1VolumeMount[] = []
    const volumes: k8s.V1Volume[] = []
    const initContainers: k8s.V1Container[] = []

    for (const [index, file] of (intent.files ?? []).entries()) {
      const fileName = `${name}-f${index}`
      const path = file.path.startsWith("/") ? file.path : `/${file.path}`
      if (path.includes("/../") || path.includes("\0")) {
        throw new Error("Invalid Kubernetes file path")
      }

      if (file.data.byteLength > 512 * 1024) {
        const sources: k8s.V1VolumeProjection[] = []

        for (
          let offset = 0, part = 0;
          offset < file.data.byteLength;
          offset += 512 * 1024, part++
        ) {
          throwIfAborted(signal)
          const partName = `${fileName}-${part}`
          const key = `part-${String(part).padStart(8, "0")}`

          await this.createOrRead(
            () =>
              this.core.createNamespacedSecret({
                namespace,
                body: {
                  metadata: { name: partName, labels },
                  data: {
                    [key]: Buffer.from(file.data.subarray(offset, offset + 512 * 1024)).toString(
                      "base64",
                    ),
                  },
                },
              }),
            () => this.core.readNamespacedSecret({ namespace, name: partName }),
          )

          sources.push({ secret: { name: partName } })
        }

        volumes.push(
          { name: `chunks-${index}`, projected: { sources } },
          { name: `file-${index}`, emptyDir: file.secret ? { medium: "Memory" } : {} },
        )

        initContainers.push({
          name: `file-${index}`,
          image: this.config.fileHelperImage ?? "busybox:1.37",
          command: [
            "sh",
            "-ec",
            `cat /chunks/part-* > /out/value; chmod ${(file.mode ?? 0o400).toString(8)} /out/value; chown ${file.uid ?? 0}:${file.gid ?? (intent.rootlessBuilder ? 1000 : 0)} /out/value`,
          ],
          volumeMounts: [
            { name: `chunks-${index}`, mountPath: "/chunks", readOnly: true },
            { name: `file-${index}`, mountPath: "/out" },
          ],
        })

        mounts.push({ name: `file-${index}`, mountPath: path, subPath: "value", readOnly: true })
        continue
      }

      const secret = {
        metadata: { name: fileName, labels },
        data: { value: Buffer.from(file.data).toString("base64") },
      }

      await this.createOrRead(
        () => this.core.createNamespacedSecret({ namespace, body: secret }),
        () => this.core.readNamespacedSecret({ namespace, name: fileName }),
      )

      volumes.push({
        name: `file-${index}`,
        secret: { secretName: fileName, defaultMode: file.mode ?? 0o400 },
      })

      mounts.push({ name: `file-${index}`, mountPath: path, subPath: "value", readOnly: true })
    }

    for (const [index, volume] of (intent.volumes ?? []).entries()) {
      await this.ensureVolume(intent.owner, volume, signal)
      volumes.push({ name: `pvc-${index}`, persistentVolumeClaim: { claimName: volume.name } })
      mounts.push({ name: `pvc-${index}`, mountPath: volume.mountPath })
    }

    let dnsConfig: k8s.V1PodDNSConfig | undefined

    if (intent.environment) {
      const service = await this.core.readNamespacedService({
        namespace,
        name: intent.environment.id,
      })

      dnsConfig = {
        nameservers: [service.spec!.clusterIP!],
        searches: [],
        options: [{ name: "ndots", value: "1" }],
      }
    }

    const spec: k8s.V1PodSpec = {
      securityContext: intent.rootlessBuilder ? { fsGroup: 1000 } : undefined,
      serviceAccountName: this.config.serviceAccount,
      automountServiceAccountToken: false,
      restartPolicy: intent.mode === "deployment" ? "Always" : "Never",
      dnsPolicy: dnsConfig ? "None" : "ClusterFirst",
      dnsConfig,
      imagePullSecrets: [
        ...new Set([...(this.config.imagePullSecrets ?? []), ...(intent.imagePullSecrets ?? [])]),
      ].map(name => ({ name })),
      volumes,
      initContainers: initContainers.length ? initContainers : undefined,
      containers: [
        {
          name: "workload",
          image: intent.image,
          command: intent.command,
          args: intent.args,
          workingDir: intent.workingDir,
          tty: intent.tty,
          stdin: true,
          securityContext: intent.rootlessBuilder
            ? {
                runAsUser: 1000,
                runAsGroup: 1000,
                seccompProfile: { type: "Unconfined" },
                appArmorProfile: { type: "Unconfined" },
              }
            : undefined,
          env: Object.entries(intent.env ?? {}).map(([name, value]) => ({ name, value })),
          volumeMounts: mounts,
          ports: intent.ports?.map(port => ({ name: port.name, containerPort: port.port })),
        },
      ],
    }

    const template = { metadata: { labels: podLabels }, spec }
    const mode = intent.mode ?? "pod"
    if (mode === "deployment") {
      await this.createOrRead(
        () =>
          this.apps.createNamespacedDeployment({
            namespace,
            body: {
              metadata: { name, labels },
              spec: {
                replicas: 1,
                selector: { matchLabels: { "highstate.io/root": name } },
                template,
              },
            },
          }),
        () => this.apps.readNamespacedDeployment({ namespace, name }),
      )
    } else if (mode === "job") {
      await this.createOrRead(
        () =>
          this.batch.createNamespacedJob({
            namespace,
            body: { metadata: { name, labels }, spec: { backoffLimit: 0, template } },
          }),
        () => this.batch.readNamespacedJob({ namespace, name }),
      )
    } else {
      await this.createOrRead(
        () =>
          this.core.createNamespacedPod({
            namespace,
            body: { metadata: { name, labels: podLabels }, spec },
          }),
        () => this.core.readNamespacedPod({ namespace, name }),
      )
    }

    if (intent.aliases?.length) {
      if (!intent.environment) {
        throw new Error("Sidecar aliases require an operation environment")
      }

      const service = await this.createOrRead(
        () =>
          this.core.createNamespacedService({
            namespace,
            body: {
              metadata: { name, labels },
              spec: {
                selector: { "highstate.io/root": name },
                ports: intent.ports?.map(port => ({
                  name: port.name,
                  port: port.port,
                  targetPort: port.port,
                })) ?? [{ name: "identity", port: 1 }],
              },
            },
          }),
        () => this.core.readNamespacedService({ namespace, name }),
      )

      await this.addAliases(intent.environment.id, intent.aliases, service.spec!.clusterIP!)
    }

    return await this.inspect(`${mode}/${name}`, signal)
  }

  private async pod(id: string, signal?: AbortSignal): Promise<k8s.V1Pod> {
    const [kind, name] = id.split("/")

    if (kind === "pod") {
      return await this.core.readNamespacedPod({ namespace: this.config.namespace, name: name! })
    }

    const pods = await this.core.listNamespacedPod({
      namespace: this.config.namespace,
      labelSelector: `highstate.io/root=${name}`,
    })

    const pod =
      pods.items.find(pod => pod.status?.phase === "Running") ??
      pods.items.find(pod => pod.status?.phase === "Pending") ??
      pods.items[0]

    if (!pod) {
      throwIfAborted(signal)
      throw Object.assign(new Error("Workload pod is pending"), { code: 404 })
    }

    return pod
  }

  async inspect(id: string, signal?: AbortSignal): Promise<NativeWorkload> {
    throwIfAborted(signal)

    try {
      const pod = await this.pod(id, signal)
      const phase = pod.status?.phase
      return {
        id,
        labels: pod.metadata?.labels ?? {},
        state:
          phase === "Running"
            ? "running"
            : phase === "Succeeded"
              ? "completed"
              : phase === "Failed"
                ? "failed"
                : "pending",
        exitCode: pod.status?.containerStatuses?.[0]?.state?.terminated?.exitCode,
      }
    } catch (error) {
      if (statusCode(error) !== 404) {
        throw error
      }

      const [kind, name] = id.split("/")

      try {
        let labels: Record<string, string> = {}

        if (kind === "deployment") {
          labels =
            (
              await this.apps.readNamespacedDeployment({
                namespace: this.config.namespace,
                name: name!,
              })
            ).metadata?.labels ?? {}
        } else if (kind === "job") {
          labels =
            (await this.batch.readNamespacedJob({ namespace: this.config.namespace, name: name! }))
              .metadata?.labels ?? {}
        } else {
          return { id, labels: {}, state: "missing" }
        }

        return { id, labels, state: "pending" }
      } catch (error) {
        if (statusCode(error) === 404) {
          return { id, labels: {}, state: "missing" }
        }

        throw error
      }
    }
  }

  async discover(labels: Record<string, string>, signal?: AbortSignal): Promise<NativeWorkload[]> {
    throwIfAborted(signal)
    const query = { namespace: this.config.namespace, labelSelector: selector(labels) }

    const [pods, deployments, jobs] = await Promise.all([
      this.core.listNamespacedPod(query),
      this.apps.listNamespacedDeployment(query),
      this.batch.listNamespacedJob(query),
    ])

    const roots = [
      ...deployments.items.map(item => `deployment/${item.metadata!.name}`),
      ...jobs.items.map(item => `job/${item.metadata!.name}`),
      ...pods.items
        .filter(
          item =>
            !item.metadata?.ownerReferences?.length && !item.metadata?.labels?.["highstate.io/dns"],
        )
        .map(item => `pod/${item.metadata!.name}`),
    ]

    return await Promise.all(roots.map(id => this.inspect(id, signal)))
  }

  async discoverResources(labels: Record<string, string>, signal?: AbortSignal) {
    throwIfAborted(signal)
    const query = { namespace: this.config.namespace, labelSelector: selector(labels) }

    const groups = await Promise.all([
      this.core.listNamespacedPod(query).then(list => ({ type: "pod", items: list.items })),
      this.core.listNamespacedService(query).then(list => ({ type: "service", items: list.items })),
      this.core.listNamespacedSecret(query).then(list => ({ type: "secret", items: list.items })),
      this.core
        .listNamespacedConfigMap(query)
        .then(list => ({ type: "configmap", items: list.items })),
      this.core
        .listNamespacedPersistentVolumeClaim(query)
        .then(list => ({ type: "pvc", items: list.items })),
      this.apps
        .listNamespacedDeployment(query)
        .then(list => ({ type: "deployment", items: list.items })),
      this.batch.listNamespacedJob(query).then(list => ({ type: "job", items: list.items })),
    ])

    return groups.flatMap(group =>
      group.items.map(item => ({
        id: `${group.type}/${item.metadata!.name}`,
        type: group.type,
        labels: item.metadata?.labels ?? {},
      })),
    )
  }

  private assertVolumeOwner(owner: RuntimeOwnership, labels: Record<string, string>) {
    if (
      labels["highstate.io/backend"] !== owner.backendId ||
      labels["highstate.io/project"] !== owner.projectId ||
      labels["highstate.io/runtime"] !== owner.runtimeId
    ) {
      throw new Error("Managed PVC belongs to another owner")
    }
  }

  async ensureVolume(
    owner: RuntimeOwnership,
    volume: RuntimeVolume,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal)
    const namespace = this.config.namespace

    const native = await this.createOrRead(
      () =>
        this.core.createNamespacedPersistentVolumeClaim({
          namespace,
          body: {
            metadata: { name: volume.name, labels: ownershipLabels(owner) },
            spec: {
              accessModes: ["ReadWriteOnce"],
              storageClassName: volume.storageClass,
              resources: { requests: { storage: volume.size ?? "1Gi" } },
            },
          },
        }),
      () => this.core.readNamespacedPersistentVolumeClaim({ namespace, name: volume.name }),
    )

    this.assertVolumeOwner(owner, native.metadata?.labels ?? {})
  }

  async removeVolume(owner: RuntimeOwnership, name: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)

    try {
      const native = await this.core.readNamespacedPersistentVolumeClaim({
        namespace: this.config.namespace,
        name,
      })

      this.assertVolumeOwner(owner, native.metadata?.labels ?? {})

      await this.core.deleteNamespacedPersistentVolumeClaim({
        namespace: this.config.namespace,
        name,
      })
    } catch (error) {
      if (statusCode(error) !== 404) {
        throw error
      }
    }
  }

  async stop(id: string, force = false, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    const [kind, name] = id.split("/")

    const request = {
      namespace: this.config.namespace,
      name: name!,
      gracePeriodSeconds: force ? 0 : 10,
      propagationPolicy: "Foreground",
    }

    try {
      if (kind === "deployment") {
        await this.apps.deleteNamespacedDeployment(request)
      } else if (kind === "job") {
        await this.batch.deleteNamespacedJob(request)
      } else {
        await this.core.deleteNamespacedPod(request)
      }
    } catch (error) {
      if (statusCode(error) !== 404) {
        throw error
      }
    }
  }

  async cleanup(owner: RuntimeOwnership, signal?: AbortSignal): Promise<void> {
    await this.builds.cancel(owner.workloadId)
    const labels = ownershipLabels(owner)
    delete labels["highstate.io/generation"]
    const query = { namespace: this.config.namespace, labelSelector: selector(labels) }

    for (const root of await this.discover(labels, signal)) {
      await this.stop(root.id, true, signal)
    }

    const resources = [
      {
        list: () => this.core.listNamespacedPod(query),
        remove: (name: string) =>
          this.core.deleteNamespacedPod({
            namespace: query.namespace,
            name,
            gracePeriodSeconds: 0,
          }),
      },
      {
        list: () => this.core.listNamespacedService(query),
        remove: (name: string) =>
          this.core.deleteNamespacedService({ namespace: query.namespace, name }),
      },
      {
        list: () => this.core.listNamespacedSecret(query),
        remove: (name: string) =>
          this.core.deleteNamespacedSecret({ namespace: query.namespace, name }),
      },
      {
        list: () => this.core.listNamespacedConfigMap(query),
        remove: (name: string) =>
          this.core.deleteNamespacedConfigMap({ namespace: query.namespace, name }),
      },
    ]

    for (const resource of resources) {
      for (const item of (await resource.list()).items) {
        throwIfAborted(signal)

        try {
          await resource.remove(item.metadata!.name!)
        } catch (error) {
          if (statusCode(error) !== 404) {
            throw error
          }
        }
      }
    }

    // deletion acknowledgement is not deletion completion; never release ownership while finalizers remain
    for (let attempt = 0; attempt < 60; attempt++) {
      const remaining = await Promise.all(resources.map(resource => resource.list()))
      const roots = await this.discover(labels, signal)
      if (remaining.every(list => list.items.length === 0) && roots.length === 0) {
        return
      }

      await delay(500, signal)
    }

    throw new Error("Kubernetes cleanup is still pending")
  }

  private async session(
    id: string,
    command: string[] | undefined,
    tty: boolean,
    signal?: AbortSignal,
  ): Promise<RuntimeSession> {
    let pod = await this.pod(id, signal)

    while (pod.status?.phase !== "Running") {
      if (pod.status?.phase === "Succeeded" || pod.status?.phase === "Failed") {
        throw new Error("Cannot attach to a terminated Kubernetes workload")
      }

      await delay(250, signal)
      pod = await this.pod(id, signal)
    }

    const effectiveTty = command
      ? tty
      : (pod.spec?.containers.find(container => container.name === "workload")?.tty ?? false)

    const input = new PassThrough()
    const output = new PassThrough()

    const stream = new Duplex({
      read() {
        output.resume()
      },
      write(chunk, encoding, callback) {
        input.write(chunk, encoding, callback)
      },
      final(callback) {
        input.end(callback)
      },
      destroy(error, callback) {
        input.destroy()
        output.destroy()
        callback(error)
      },
    })

    output.on("data", chunk => {
      if (!stream.push(chunk)) {
        output.pause()
      }
    })

    output.on("end", () => stream.push(null))

    output.on("error", error => {
      if (!stream.destroyed) {
        stream.destroy(error)
      }
    })

    input.on("error", error => {
      if (!stream.destroyed) {
        stream.destroy(error)
      }
    })

    output.pause()
    let finish: (value: number | undefined) => void = () => {}

    const completed = new Promise<number | undefined>(resolve => {
      finish = resolve
    })

    const connecting = command
      ? new k8s.Exec(this.kubeconfig).exec(
          this.config.namespace,
          pod.metadata!.name!,
          "workload",
          command,
          output,
          effectiveTty ? null : output,
          input,
          effectiveTty,
          status => {
            const exitCode = status.details?.causes?.find(
              cause => cause.reason === "ExitCode",
            )?.message

            finish(status.status === "Success" ? 0 : Number(exitCode ?? 1))
            output.end()
          },
        )
      : new k8s.Attach(this.kubeconfig).attach(
          this.config.namespace,
          pod.metadata!.name!,
          "workload",
          output,
          effectiveTty ? null : output,
          input,
          effectiveTty,
        )

    void connecting
      .then(socket => {
        if (signal?.aborted) {
          socket.close()
        }
      })
      .catch(() => {})

    const socket = await abortable(connecting, signal)

    const close = () => {
      socket.close()
      input.destroy()
      output.destroy()
    }

    stream.once("close", close)
    signal?.addEventListener("abort", close, { once: true })

    socket.once("close", () => {
      signal?.removeEventListener("abort", close)
      output.end()
      input.end()
      finish(command ? -1 : undefined)
    })

    socket.once("error", error => stream.destroy(error))
    return {
      stream,
      close,
      completed,
      resize: async (columns, rows) => {
        socket.send(
          Buffer.concat([
            Buffer.from([4]),
            Buffer.from(JSON.stringify({ Width: columns, Height: rows })),
          ]),
        )
      },
    }
  }

  async attach(id: string, signal?: AbortSignal) {
    return await this.session(id, undefined, true, signal)
  }

  async exec(id: string, command: string[], options?: { tty?: boolean; signal?: AbortSignal }) {
    return await this.session(id, command, options?.tty ?? false, options?.signal)
  }

  async putFiles(id: string, files: RuntimeFile[], signal?: AbortSignal): Promise<void> {
    const session = await this.exec(id, ["tar", "-xmf", "-", "-C", "/"], { signal })
    session.stream.resume()
    session.stream.end(await archiveFiles(files))
    const code = await abortable(session.completed, signal)
    if (code !== 0) {
      throw new Error("Kubernetes file transfer failed")
    }
  }

  async *logs(id: string, follow = false, signal?: AbortSignal): AsyncIterable<RuntimeLog> {
    const pod = await this.pod(id, signal)
    const stream = new PassThrough()

    const controller = await new k8s.Log(this.kubeconfig).log(
      this.config.namespace,
      pod.metadata!.name!,
      "workload",
      stream,
      { follow },
    )

    const close = () => {
      controller.abort()
      stream.destroy()
    }

    signal?.addEventListener("abort", close, { once: true })

    try {
      for await (const chunk of stream) {
        yield { stream: "stdout" as const, data: Buffer.from(chunk) }
      }
    } finally {
      signal?.removeEventListener("abort", close)
      close()
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
    if (!request.repository) {
      throw new Error("Kubernetes builds require an image repository")
    }

    const files = snapshotBuildFiles(request)
    const tag = buildTag(request)
    const credentials = request.registryCredentials ?? this.config.registryCredentials ?? []

    const dockerConfig = JSON.stringify({
      auths: Object.fromEntries(
        credentials.map(item => [
          item.serveraddress,
          { auth: Buffer.from(`${item.username}:${item.password}`).toString("base64") },
        ]),
      ),
    })

    const namespace = this.config.namespace
    const pullSecret = `${nativeName(`${request.owner.workloadId}/${request.owner.generation}`)}-registry`

    if (credentials.length) {
      await this.createOrRead(
        () =>
          this.core.createNamespacedSecret({
            namespace,
            body: {
              metadata: { name: pullSecret, labels: ownershipLabels(request.owner) },
              type: "kubernetes.io/dockerconfigjson",
              data: { ".dockerconfigjson": Buffer.from(dockerConfig).toString("base64") },
            },
          }),
        () => this.core.readNamespacedSecret({ namespace, name: pullSecret }),
      )
    }

    await progress("installing")

    const root = await this.place(
      {
        owner: request.owner,
        mode: "job",
        image: this.config.buildkitImage,
        rootlessBuilder: true,
        command: ["rootlesskit", "--copy-up=/run", "sh", "-ec"],
        args: [
          'if [ -n "$NPM_SECRET" ]; then set -- --secret id=npmrc,src=/secrets/npmrc; else set --; fi; exec buildctl-daemonless.sh build --frontend dockerfile.v0 --local context=/context --local dockerfile=/context --opt platform="$TARGET_PLATFORMS" "$@" --output "$TARGET_OUTPUT"',
        ],
        env: {
          BUILDKITD_FLAGS: "--oci-worker-no-process-sandbox",
          DOCKER_CONFIG: "/registry",
          TARGET_OUTPUT: `type=image,name=${tag},push=true${this.config.allowHttpRegistry ? ",registry.insecure=true" : ""}`,
          TARGET_PLATFORMS: request.platforms?.join(",") ?? "linux/amd64",
          NPM_SECRET: request.secrets?.length ? "yes" : "",
        },
        files: [
          ...files.map(file => ({ ...file, path: `context/${file.path}`, mode: 0o444 })),
          {
            path: "registry/config.json",
            data: Buffer.from(dockerConfig),
            secret: true,
            mode: 0o444,
          },
          ...(request.secrets?.length
            ? [{ path: "secrets/npmrc", data: request.secrets[0]!.data, secret: true, mode: 0o444 }]
            : []),
        ],
        imagePullSecrets: credentials.length ? [pullSecret] : [],
      },
      signal,
    )

    await progress("building")

    for (;;) {
      const state = await this.inspect(root.id, signal)
      if (state.state === "failed" || state.state === "missing") {
        throw new Error("Rootless BuildKit job failed")
      }

      if (state.state === "completed") {
        break
      }

      await delay(500, signal)
    }

    await progress("pushing")
    await progress("verifying")
    const image = await this.ensureImage(tag, credentials, signal)
    if (image.imageHash !== request.snapshotHash) {
      throw new Error("Built image snapshot hash mismatch")
    }

    return image
  }
}

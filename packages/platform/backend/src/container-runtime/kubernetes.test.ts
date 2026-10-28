import type { RuntimeOwnership } from "./contracts"
import { createServer } from "node:http"
import * as k8s from "@kubernetes/client-node"
import { describe, expect, it, vi } from "vitest"
import { workloadFingerprint } from "./intent"
import { KubernetesRuntimeAdapter, type KubernetesRuntimeConfig, nativeName } from "./kubernetes"

type Resource = {
  metadata: {
    name: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
    resourceVersion?: string
  }
  spec?: Record<string, unknown>
  data?: Record<string, string>
  status?: unknown
}

async function withCluster(
  run: (adapter: KubernetesRuntimeAdapter, resources: Map<string, Resource>) => Promise<void>,
  options: Partial<KubernetesRuntimeConfig> = {},
) {
  const resources = new Map<string, Resource>()
  let sequence = 10
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://localhost")
    const path = url.pathname
    response.setHeader("Content-Type", "application/json")
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    if (request.method === "POST") {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Resource
      const key = `${path}/${body.metadata.name}`
      if (resources.has(key)) {
        response.statusCode = 409
        return response.end('{"message":"Conflict","code":409}')
      }
      body.metadata.resourceVersion = "1"
      if (path.endsWith("/services"))
        body.spec = { ...body.spec, clusterIP: `10.0.0.${sequence++}` }
      if (path.endsWith("/pods")) body.status = { phase: "Running" }
      resources.set(key, body)
      if (path.endsWith("/jobs")) {
        const template = body.spec!.template as Resource
        resources.set(`/api/v1/namespaces/test/pods/${body.metadata.name}-child`, {
          ...template,
          metadata: { ...template.metadata, name: `${body.metadata.name}-child` },
          status: { phase: "Succeeded" },
        })
      }
      response.statusCode = 201
      return response.end(JSON.stringify(body))
    }
    if (request.method === "PUT") {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Resource
      const existing = resources.get(path)
      if (existing?.metadata.resourceVersion !== body.metadata.resourceVersion) {
        response.statusCode = 409
        return response.end('{"message":"Conflict","code":409}')
      }
      body.metadata.resourceVersion = String(Number(body.metadata.resourceVersion) + 1)
      resources.set(path, body)
      return response.end(JSON.stringify(body))
    }
    if (request.method === "DELETE") {
      if (resources.get(path)?.metadata.annotations?.["test/block-delete"] === "true") {
        response.statusCode = 403
        return response.end('{"message":"Delete denied","code":403}')
      }
      resources.delete(path)
      return response.end('{"status":"Success"}')
    }
    const existing = resources.get(path)
    if (existing) return response.end(JSON.stringify(existing))
    if (
      /\/(pods|services|secrets|configmaps|persistentvolumeclaims|deployments|jobs)$/.test(path)
    ) {
      const labels = (url.searchParams.get("labelSelector") ?? "")
        .split(",")
        .filter(Boolean)
        .map(item => item.split("="))
      const items = [...resources]
        .filter(
          ([key, value]) =>
            key.startsWith(`${path}/`) &&
            !key.slice(path.length + 1).includes("/") &&
            labels.every(([key, valueLabel]) => value.metadata.labels?.[key!] === valueLabel),
        )
        .map(([, value]) => value)
      return response.end(JSON.stringify({ items }))
    }
    response.statusCode = 404
    return response.end('{"message":"Not found","code":404}')
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as { port: number }).port
  const config = new k8s.KubeConfig()
  config.loadFromOptions({
    clusters: [{ name: "test", server: `http://127.0.0.1:${port}`, skipTLSVerify: true }],
    users: [{ name: "test" }],
    contexts: [{ name: "test", cluster: "test", user: "test" }],
    currentContext: "test",
  })
  const adapter = new KubernetesRuntimeAdapter(
    {
      namespace: "test",
      serviceAccount: "runtime",
      buildkitImage: "moby/buildkit:rootless",
      clusterDns: "10.96.0.10",
      ...options,
    },
    config,
  )
  try {
    await run(adapter, resources)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

const owner: RuntimeOwnership = {
  backendId: "backend",
  projectId: "project",
  runtimeId: "runtime",
  workloadId: "operation-a",
  generation: 1,
  kind: "pulumi",
}

describe("Kubernetes API placement", () => {
  it("places intents whose fingerprints have non-alphanumeric label boundaries", async () => {
    await withCluster(async (adapter, resources) => {
      let intent = { owner, image: "runner", env: { VALUE: "0" } }
      for (let value = 0; ; value++) {
        intent = { ...intent, env: { VALUE: String(value) } }
        if (/^[-_]|[-_]$/.test(workloadFingerprint(intent))) break
      }
      const root = await adapter.place(intent)
      const pod = resources.get(`/api/v1/namespaces/test/pods/${root.id.split("/")[1]}`)!
      expect(pod.metadata.labels!["highstate.io/intent"]).toMatch(
        /^[A-Za-z0-9][-A-Za-z0-9_.]{0,61}[A-Za-z0-9]$/,
      )
      expect((await adapter.place(intent)).id).toBe(root.id)
      await expect(adapter.place({ ...intent, image: "changed" })).rejects.toThrow(/declaration/)
    })
  })
  it("transfers large build-context files through bounded secret chunks and an init volume", async () => {
    await withCluster(async (adapter, resources) => {
      const data = Buffer.alloc(1200 * 1024, 73)
      const root = await adapter.place({
        owner,
        image: "runner",
        files: [{ path: "context/bun.lock", data, mode: 0o444 }],
      })
      const chunks = [...resources.entries()]
        .filter(([path]) => path.includes("/secrets/"))
        .flatMap(([, resource]) =>
          Object.values(resource.data ?? {}).map(value => Buffer.from(value, "base64")),
        )
      expect(chunks).toHaveLength(3)
      expect(chunks.every(chunk => chunk.length <= 512 * 1024)).toBe(true)
      expect(Buffer.concat(chunks)).toEqual(data)
      const pod = resources.get(
        `/api/v1/namespaces/test/pods/${root.id.split("/")[1]}`,
      ) as unknown as k8s.V1Pod
      expect(pod.spec!.initContainers![0]!.command![2]).toContain("cat /chunks/part-*")
      expect(pod.spec!.containers[0]!.volumeMounts![0]).toMatchObject({
        mountPath: "/context/bun.lock",
        readOnly: true,
      })
    })
  })
  it("isolates unchanged dotted DNS aliases, and rejects conflicting declarations", async () => {
    await withCluster(async (adapter, resources) => {
      const first = await adapter.createEnvironment(owner)
      const initialConfig = resources.get(`/api/v1/namespaces/test/configmaps/${first.id}`)!
      // CoreDNS rejects intervals below two seconds and jitter above half the interval
      const reload = initialConfig.data!.Corefile!.match(/reload (\d+)s (\d+)s/)
      expect(reload).not.toBeNull()
      expect(Number(reload![1])).toBeGreaterThanOrEqual(2)
      expect(Number(reload![2])).toBeGreaterThanOrEqual(1)
      expect(Number(reload![2])).toBeLessThanOrEqual(Number(reload![1]) / 2)
      const secondOwner = { ...owner, workloadId: "operation-b" }
      const second = await adapter.createEnvironment(secondOwner)
      const alias = "stable.caller.resource"
      const sidecarA = {
        owner: { ...owner, workloadId: "sidecar-a", kind: "sidecar" as const },
        image: "example@sha256:aaa",
        aliases: [alias],
        environment: first,
      }
      const sidecarB = {
        ...sidecarA,
        owner: { ...sidecarA.owner, workloadId: "sidecar-b" },
        environment: second,
      }
      await adapter.place(sidecarA)
      await adapter.place(sidecarB)
      const firstConfig = resources.get(`/api/v1/namespaces/test/configmaps/${first.id}`)!
      const secondConfig = resources.get(`/api/v1/namespaces/test/configmaps/${second.id}`)!
      const firstMapping = JSON.parse(firstConfig.metadata.annotations!["highstate.io/aliases"]!)
      const secondMapping = JSON.parse(secondConfig.metadata.annotations!["highstate.io/aliases"]!)
      expect(firstMapping[alias]).not.toBe(secondMapping[alias])
      expect(firstConfig.data!.Corefile).toContain(`${alias}:53`)
      expect(firstConfig.data!.Corefile).toContain("forward . 10.96.0.10")
      expect(firstConfig.data!.Corefile!.match(/reload (\d+)s (\d+)s/)?.[0]).toBe(reload![0])
      const pod = resources.get(
        `/api/v1/namespaces/test/pods/${nativeName("sidecar-a/1")}`,
      ) as unknown as k8s.V1Pod
      const service = resources.get(`/api/v1/namespaces/test/services/${first.id}`)!
      expect(pod.spec!.dnsConfig!.nameservers).toEqual([service.spec!.clusterIP])
      expect(pod.spec!.dnsConfig!.searches).toEqual([])
      expect((await adapter.place(sidecarA)).id).toContain(nativeName("sidecar-a/1"))
      await expect(adapter.place({ ...sidecarA, image: "different" })).rejects.toThrow(
        /declaration/,
      )
      await expect(
        adapter.place({ ...sidecarA, owner: { ...sidecarA.owner, workloadId: "conflict" } }),
      ).rejects.toThrow(/already belongs/)
      expect([...resources.keys()].every(path => path.includes("/namespaces/test/"))).toBe(true)
    })
  })

  it("creates Deployments, managed PVCs, projected files and namespace-scoped cleanup", async () => {
    await withCluster(async (adapter, resources) => {
      const workerOwner = { ...owner, workloadId: "worker", kind: "worker" as const }
      const root = await adapter.place({
        owner: workerOwner,
        mode: "deployment",
        image: "worker",
        files: [
          { path: "run/token", data: Buffer.from("secret-value"), secret: true, mode: 0o400 },
        ],
        volumes: [{ name: "state", mountPath: "/state", size: "2Gi", storageClass: "storage" }],
      })
      expect(root.id).toMatch(/^deployment\//)
      const deployment = resources.get(
        `/apis/apps/v1/namespaces/test/deployments/${root.id.split("/")[1]}`,
      ) as unknown as k8s.V1Deployment
      expect(deployment.spec!.template.spec!.automountServiceAccountToken).toBe(false)
      expect(deployment.spec!.template.spec!.volumes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ persistentVolumeClaim: { claimName: "state" } }),
        ]),
      )
      expect(JSON.stringify(deployment)).not.toContain("secret-value")
      expect([...resources.values()].find(item => item.data?.value)?.data?.value).toBe(
        Buffer.from("secret-value").toString("base64"),
      )
      await expect(
        adapter.removeVolume({ ...workerOwner, projectId: "other" }, "state"),
      ).rejects.toThrow(/another owner/)
      const secret = [...resources.entries()].find(([path]) => path.includes("/secrets/"))![1]
      secret.metadata.annotations = { "test/block-delete": "true" }
      await expect(adapter.cleanup(workerOwner)).rejects.toThrow()
      expect([...resources.keys()].some(path => path.includes("/secrets/"))).toBe(true)
      secret.metadata.annotations = {}
      await adapter.cleanup(workerOwner)
      await adapter.cleanup(workerOwner)
      expect([...resources.keys()]).toEqual([
        "/api/v1/namespaces/test/persistentvolumeclaims/state",
      ])
      await adapter.removeVolume(workerOwner, "state")
      expect(resources.size).toBe(0)
    })
  })

  it.each([
    false,
    true,
  ])("builds with a rootless Job and mounted secrets (HTTP registry: %s)", async allowHttpRegistry => {
    await withCluster(
      async (adapter, resources) => {
        const buildOwner = { ...owner, kind: "library_build" as const, workloadId: "build" }
        const digest = `sha256:${"b".repeat(64)}`
        const ensure = vi.spyOn(adapter, "ensureImage").mockResolvedValue({
          reference: `registry.example/image@${digest}`,
          digest,
          imageHash: "snapshot-hash",
        })
        const result = await adapter.buildImage(
          {
            owner: buildOwner,
            baseImage: `runner@sha256:${"a".repeat(64)}`,
            repository: "registry.example/image",
            snapshotId: "snapshot",
            snapshotHash: "snapshot-hash",
            files: [
              { path: "package.json", data: Buffer.from('{"dependencies":{"example":"1.0.0"}}') },
              { path: "bun.lock", data: Buffer.from("frozen-lockfile") },
            ],
            secrets: [{ path: "npmrc", data: Buffer.from("npm-secret"), secret: true }],
          },
          async () => {},
        )
        expect(result.digest).toBe(digest)
        expect(ensure).toHaveBeenCalled()
        const job = [...resources.entries()].find(([path]) =>
          path.includes("/jobs/"),
        )![1] as unknown as k8s.V1Job
        const container = job.spec!.template.spec!.containers[0]!
        expect(container.command).toEqual(["rootlesskit", "--copy-up=/run", "sh", "-ec"])
        expect(container.args![0]).toContain("buildctl-daemonless.sh")
        expect(container.securityContext!.runAsUser).toBe(1000)
        expect(container.securityContext!.privileged).toBeUndefined()
        expect(container.env!.find(item => item.name === "TARGET_OUTPUT")!.value).toMatch(
          allowHttpRegistry ? /,registry\.insecure=true$/ : /,push=true$/,
        )
        expect(JSON.stringify(job)).not.toContain("npm-secret")
        const dockerfile = [...resources.values()]
          .flatMap(item => Object.values(item.data ?? {}))
          .map(value => Buffer.from(value, "base64").toString())
          .find(value => value.startsWith("# syntax="))!
        expect(dockerfile).toContain("--frozen-lockfile")
        expect(dockerfile).toContain("--mount=type=secret")
        expect(dockerfile).not.toContain("npm-secret")
        expect(job.spec!.backoffLimit).toBe(0)
      },
      { allowHttpRegistry },
    )
  })
})

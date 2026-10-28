import type { Evidence } from "../harness/evidence"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type ContainerRuntimeAdapter, createContainerRuntimeAdapter } from "@highstate/backend"
import { command } from "../harness/process"
import { provisionImageRegistry } from "./image-registry"

export type RuntimeEngine = "local-docker" | "remote-docker" | "kubernetes"

export type RuntimeFixture = {
  adapter: ContainerRuntimeAdapter
  transport: string
  publication?: { adapter: ContainerRuntimeAdapter; repository: string }
  diagnose?(): Promise<void>
  dispose(): Promise<void>
}

export function runtimeEngine(): RuntimeEngine {
  const engine = process.env.HIGHSTATE_E2E_RUNTIME
  if (engine !== "local-docker" && engine !== "remote-docker" && engine !== "kubernetes") {
    throw new Error("Set HIGHSTATE_E2E_RUNTIME to local-docker, remote-docker, or kubernetes")
  }
  return engine
}

export async function provisionRuntime(
  engine: RuntimeEngine,
  id: string,
  evidence: Evidence,
): Promise<RuntimeFixture> {
  if (engine === "local-docker") {
    return {
      transport: "docker-engine",
      adapter: createContainerRuntimeAdapter({
        type: "docker",
        endpoint: process.env.DOCKER_HOST ?? "unix:///var/run/docker.sock",
        local: true,
      }),
      async dispose() {
        const args = [
          "docker",
          "image",
          "ls",
          "--quiet",
          "--filter",
          `label=highstate.io/backend=${id}`,
        ]
        const images = (await command(args)).split(/\s+/).filter(Boolean)
        if (images.length) await command(["docker", "image", "rm", "--force", ...images])
        const remainingImages = await command(args)
        await evidence.write("infrastructure-cleanup.json", { remainingImages })
        if (remainingImages) throw new Error("Conformance build images survived cleanup")
      },
    }
  }

  if (engine === "remote-docker") {
    const name = `${id}-dind`
    const registry = await provisionImageRegistry(id, evidence)
    try {
      await command(
        [
          "docker",
          "run",
          "--detach",
          "--privileged",
          "--name",
          name,
          "--label",
          `highstate.io/e2e=${id}`,
          "--publish",
          "127.0.0.1::2375",
          "--env",
          "DOCKER_TLS_CERTDIR=",
          "docker:28.2.2-dind",
          "--tls=false",
          `--insecure-registry=${registry.address}`,
        ],
        { evidence, name: "dind-start.log" },
      )
      const binding = await command(["docker", "port", name, "2375/tcp"])
      const endpoint = `http://${binding}`
      const deadline = Date.now() + 90_000
      while (true) {
        try {
          const response = await fetch(`${endpoint}/_ping`, { signal: AbortSignal.timeout(2000) })
          if (response.ok) break
        } catch {}
        if (Date.now() > deadline) throw new Error("Disposable Docker daemon did not become ready")
        await Bun.sleep(500)
      }
      const host = await command(["docker", "info", "--format", "{{.ID}}"])
      const remote = await command([
        "docker",
        "--host",
        `tcp://${binding}`,
        "info",
        "--format",
        "{{.ID}}",
      ])
      if (host === remote) throw new Error("Remote Docker must be a separate daemon")
      await evidence.write("daemon-isolation.json", { host, remote, separate: host !== remote })
      return {
        transport: "separate-dind",
        adapter: createContainerRuntimeAdapter({ type: "docker", endpoint, local: false }),
        publication: {
          repository: registry.repository,
          adapter: createContainerRuntimeAdapter({
            type: "docker",
            endpoint,
            local: false,
            allowHttpRegistry: true,
          }),
        },
        async dispose() {
          await registry.dispose()
          await command(["docker", "logs", name], { evidence, name: "dind.log" })
          await command(["docker", "rm", "--force", "--volumes", name])
          const remaining = await command([
            "docker",
            "ps",
            "--all",
            "--quiet",
            "--filter",
            `label=highstate.io/e2e=${id}`,
          ])
          await evidence.write("infrastructure-cleanup.json", { remaining })
          if (remaining) throw new Error("Disposable Docker daemon survived cleanup")
        },
      }
    } catch (error) {
      await command(["docker", "rm", "--force", "--volumes", name]).catch(() => {})
      await registry.dispose()
      throw error
    }
  }

  const kind = process.env.HIGHSTATE_E2E_KIND ?? Bun.which("kind") ?? "/tmp/opencode/kind"
  const directory = await mkdtemp(join(tmpdir(), "highstate-conformance-"))
  const kubeconfig = join(directory, "kubeconfig")
  const registry = await provisionImageRegistry(id, evidence)
  let proxy: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined
  let proxyOutput: Promise<string[]> | undefined
  const dispose = async () => {
    try {
      if (proxy) {
        proxy.kill()
        await proxy.exited
        await evidence.write("kubectl-proxy.log", await proxyOutput)
      }
      await command([kind, "delete", "cluster", "--name", id], {
        evidence,
        name: "kind-delete.log",
      })
      const remaining = await command([
        "docker",
        "ps",
        "--all",
        "--quiet",
        "--filter",
        `label=io.x-k8s.kind.cluster=${id}`,
      ])
      await evidence.write("infrastructure-cleanup.json", { remaining })
      if (remaining) throw new Error("Disposable kind nodes survived cleanup")
    } finally {
      await registry.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  }
  try {
    const hostsDirectory = join(directory, "registry", registry.address)
    await mkdir(hostsDirectory, { recursive: true })
    await writeFile(
      join(hostsDirectory, "hosts.toml"),
      `server = "http://${registry.address}"\n[host."http://${registry.address}"]\n  capabilities = ["pull", "resolve"]\n`,
    )
    const kindConfig = join(directory, "kind.yaml")
    await writeFile(
      kindConfig,
      `kind: Cluster\napiVersion: kind.x-k8s.io/v1alpha4\ncontainerdConfigPatches:\n- |-\n  [plugins."io.containerd.grpc.v1.cri".registry]\n    config_path = "/etc/containerd/certs.d"\n  [plugins."io.containerd.cri.v1.images".registry]\n    config_path = "/etc/containerd/certs.d"\nnodes:\n- role: control-plane\n`,
    )
    await command(
      [
        kind,
        "create",
        "cluster",
        "--name",
        id,
        "--kubeconfig",
        kubeconfig,
        "--config",
        kindConfig,
        "--wait",
        "180s",
      ],
      {
        evidence,
        name: "kind-create.log",
        timeoutMs: 600_000,
      },
    )
    await command([
      "docker",
      "cp",
      `${join(directory, "registry")}/.`,
      `${id}-control-plane:/etc/containerd/certs.d/`,
    ])
    await command(["kubectl", "--kubeconfig", kubeconfig, "create", "namespace", id])
    await command([
      "kubectl",
      "--kubeconfig",
      kubeconfig,
      "label",
      "namespace",
      id,
      `highstate.io/e2e=${id}`,
    ])
    if (process.env.HIGHSTATE_E2E_KUBERNETES_TRANSPORT === "direct") {
      const config = await readFile(kubeconfig, "utf8")
      return {
        transport: "direct-kubeconfig",
        adapter: createContainerRuntimeAdapter({
          type: "kubernetes",
          namespace: id,
          serviceAccount: "default",
          buildkitImage: "mirror.gcr.io/moby/buildkit:v0.20.2-rootless",
          dnsImage: "mirror.gcr.io/coredns/coredns:1.12.0",
          kubeconfig: config,
        }),
        publication: {
          repository: registry.repository,
          adapter: createContainerRuntimeAdapter({
            type: "kubernetes",
            namespace: id,
            serviceAccount: "default",
            buildkitImage: "mirror.gcr.io/moby/buildkit:v0.20.2-rootless",
            kubeconfig: config,
            allowHttpRegistry: true,
          }),
        },
        dispose,
      }
    }
    // Bun's fetch ignores the Kubernetes client's undici TLS dispatcher; kubectl retains
    // certificate verification and client authentication on the upstream connection
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string")
      throw new Error("Cannot allocate kubectl proxy port")
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    )
    proxy = Bun.spawn(
      [
        "kubectl",
        "--kubeconfig",
        kubeconfig,
        "proxy",
        "--address=127.0.0.1",
        "--reject-paths=^$",
        `--port=${address.port}`,
      ],
      { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    )
    proxyOutput = Promise.all([
      new Response(proxy.stdout).text(),
      new Response(proxy.stderr).text(),
    ])
    const endpoint = `http://127.0.0.1:${address.port}`
    const deadline = Date.now() + 15_000
    while (true) {
      try {
        if ((await fetch(`${endpoint}/version`, { signal: AbortSignal.timeout(1000) })).ok) break
      } catch {}
      if (Date.now() > deadline) throw new Error("Authenticated kubectl proxy did not become ready")
      await Bun.sleep(100)
    }
    const config = JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      "current-context": id,
      clusters: [{ name: id, cluster: { server: endpoint, "insecure-skip-tls-verify": true } }],
      contexts: [{ name: id, context: { cluster: id, user: id } }],
      users: [{ name: id, user: {} }],
    })
    await evidence.write("kubernetes-transport.json", {
      transport: "authenticated-kubectl-proxy",
      upstreamTlsVerified: true,
      reason: "Bun fetch does not apply the Kubernetes undici TLS dispatcher",
    })
    return {
      transport: "authenticated-kubectl-proxy",
      async diagnose() {
        for (const [name, args] of [
          ["kubernetes-pods.json", ["get", "pods,services,configmaps", "-o", "json"]],
          ["operation-dns.log", ["logs", "--selector=highstate.io/dns", "--all-containers=true"]],
          [
            "buildkit.log",
            ["logs", `--selector=highstate.io/workload=${id}-build`, "--all-containers=true"],
          ],
          ["kubernetes-events.json", ["get", "events", "-o", "json"]],
        ] as const) {
          await command(["kubectl", "--kubeconfig", kubeconfig, "--namespace", id, ...args], {
            evidence,
            name,
          }).catch(async error => {
            await evidence.write(`${name}.error`, String(error))
          })
        }
      },
      adapter: createContainerRuntimeAdapter({
        type: "kubernetes",
        namespace: id,
        serviceAccount: "default",
        buildkitImage: "mirror.gcr.io/moby/buildkit:v0.20.2-rootless",
        dnsImage: "mirror.gcr.io/coredns/coredns:1.12.0",
        kubeconfig: config,
      }),
      publication: {
        repository: registry.repository,
        adapter: createContainerRuntimeAdapter({
          type: "kubernetes",
          namespace: id,
          serviceAccount: "default",
          buildkitImage: "mirror.gcr.io/moby/buildkit:v0.20.2-rootless",
          kubeconfig: config,
          allowHttpRegistry: true,
        }),
      },
      async dispose() {
        try {
          await command(
            [
              "kubectl",
              "--kubeconfig",
              kubeconfig,
              "get",
              "pods,services,pvc,events",
              "--namespace",
              id,
              "-o",
              "wide",
            ],
            { evidence, name: "kubernetes-state.log" },
          )
        } finally {
          await dispose()
        }
      },
    }
  } catch (error) {
    await dispose()
    throw error
  }
}

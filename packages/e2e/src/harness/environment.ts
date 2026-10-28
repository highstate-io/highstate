import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Cleanup } from "./cleanup"
import { Evidence } from "./evidence"
import { command } from "./process"
import { waitFor } from "./wait"

export async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "0.0.0.0", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No allocated port")
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve())),
  )
  return address.port
}

/** Allocates only disposable run-scoped infrastructure and builds the product runner from this checkout. */
export async function createEnvironment() {
  const root = resolve(import.meta.dir, "../../../..")
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`
  const evidence = new Evidence(join(root, ".artifacts/e2e", runId))
  const cleanup = new Cleanup()
  const directory = await mkdtemp(join(tmpdir(), "highstate-e2e-"))
  cleanup.add(async () => {
    if (process.env.HIGHSTATE_E2E_KEEP_FAILED !== "1")
      await rm(directory, { recursive: true, force: true })
  })
  try {
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: "highstate-e2e-isolated", private: true, workspaces: [] }),
    )
    await writeFile(
      join(directory, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "highstate-e2e-isolated" } },
        packages: {},
      }),
    )
    const engine = await command(["docker", "info", "--format", "{{json .ServerVersion}}"])
    const host = await command([
      "docker",
      "network",
      "inspect",
      "bridge",
      "--format",
      "{{(index .IPAM.Config 0).Gateway}}",
    ])
    await command([
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=host.docker.internal",
      "-addext",
      `subjectAltName=DNS:host.docker.internal,IP:${host},IP:127.0.0.1`,
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem"),
    ])
    evidence.redact(await readFile(join(directory, "key.pem"), "utf8"))
    await evidence.write("environment.json", {
      runId,
      engine: JSON.parse(engine),
      bun: Bun.version,
      commit: await command(["git", "rev-parse", "HEAD"], { cwd: root }),
      runtime: "local-docker",
    })
    const registry = `highstate-e2e-registry-${runId.toLowerCase()}`
    await command([
      "docker",
      "run",
      "-d",
      "--name",
      registry,
      "--label",
      `highstate.io/e2e=${runId}`,
      "-p",
      "127.0.0.1::5000",
      "registry:2",
    ])
    cleanup.add(async () => {
      await command(["docker", "rm", "-fv", registry])
    })
    const binding = await command(["docker", "port", registry, "5000/tcp"])
    const registryAddress = binding.replace("127.0.0.1", "localhost")
    await waitFor(
      "OCI registry readiness",
      async () => {
        try {
          return (await fetch(`http://${registryAddress}/v2/`)).status
        } catch {
          return 0
        }
      },
      status => status === 200,
      30_000,
    )
    const imageTag = `${registryAddress}/highstate-e2e-runner:${runId}`
    if (process.env.HIGHSTATE_E2E_REUSE_RUNNER !== "1") {
      await command(
        [
          "docker",
          "build",
          "-f",
          "packages/platform/backend/docker/runner.Dockerfile",
          "-t",
          "highstate-e2e-runner:build",
          ".",
        ],
        { cwd: root, evidence, name: "runner-build.log", timeoutMs: 900_000 },
      )
    }
    await command(["docker", "tag", "highstate-e2e-runner:build", imageTag])
    cleanup.add(async () => {
      await command(["docker", "image", "rm", "-f", imageTag])
    })
    await command(["docker", "push", imageTag], { evidence, name: "runner-push.log" })
    const runnerImage = (
      JSON.parse(
        await command([
          "docker",
          "image",
          "inspect",
          imageTag,
          "--format",
          "{{json .RepoDigests}}",
        ]),
      ) as string[]
    ).find(reference => reference.startsWith(`${registryAddress}/`))
    if (!runnerImage?.includes("@sha256:")) throw new Error("Built runner has no registry digest")
    const cert = await readFile(join(directory, "cert.pem"), "utf8")
    const url = `http://127.0.0.1:${await freePort()}`
    const runtimePort = await freePort()
    const projectId = `e${randomUUID().replaceAll("-", "").slice(0, 23)}`
    return {
      root,
      runId,
      evidence,
      cleanup,
      directory,
      host,
      runnerImage,
      cert,
      url,
      runtimePort,
      projectId,
    }
  } catch (error) {
    await evidence.write("result.json", { status: "failed", error: String(error) })
    await cleanup.run()
    throw error
  }
}
export type Environment = Awaited<ReturnType<typeof createEnvironment>>

/** Records and removes resources of this run's projects, including when the backend has crashed. */
export async function cleanupProjectResources(
  projectId: string,
  evidence: Evidence,
): Promise<void> {
  const filter = `label=highstate.io/project=${projectId}`
  const inventory: Record<string, string[]> = {}
  for (const kind of ["container", "network", "volume"] as const) {
    const ids = (
      await command([
        "docker",
        kind,
        "ls",
        ...(kind === "container" ? ["-a"] : []),
        "-q",
        "--filter",
        filter,
      ])
    )
      .split(/\s+/)
      .filter(Boolean)
    inventory[kind] = ids
  }
  await evidence.write(`resources-${projectId}.json`, inventory)
  for (const id of inventory.container ?? []) {
    try {
      await command(["docker", "logs", id], { evidence, name: `container-${id}.log` })
    } catch (error) {
      if (!String(error).includes("No such container")) throw error
    }
  }
  for (const [kind, ids] of Object.entries(inventory)) {
    if (!ids.length) continue
    const remaining = (
      await command([
        "docker",
        kind,
        "ls",
        ...(kind === "container" ? ["-a"] : []),
        "-q",
        "--filter",
        filter,
      ])
    )
      .split(/\s+/)
      .filter(Boolean)
    if (remaining.length)
      await command(["docker", kind, "rm", ...(kind === "container" ? ["-fv"] : []), ...remaining])
  }
  for (const kind of ["container", "network", "volume"]) {
    if (
      await command([
        "docker",
        kind,
        "ls",
        ...(kind === "container" ? ["-a"] : []),
        "-q",
        "--filter",
        filter,
      ])
    )
      throw new Error(`Leaked ${kind} for project "${projectId}"`)
  }
  const images = (await command(["docker", "image", "ls", "-aq", "--filter", filter]))
    .split(/\s+/)
    .filter(Boolean)
  if (images.length) await command(["docker", "image", "rm", "-f", ...new Set(images)])
  if (await command(["docker", "image", "ls", "-aq", "--filter", filter]))
    throw new Error(`Leaked images for project "${projectId}"`)
  await evidence.write(`cleanup-${projectId}.json`, {
    containers: [],
    networks: [],
    volumes: [],
    images: [],
  })
}

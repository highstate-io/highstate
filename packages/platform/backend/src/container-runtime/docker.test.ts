import type { ImageBuildRequest, RuntimeOwnership } from "./contracts"
import { randomUUID } from "node:crypto"
import { createServer, type Server } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { createDockerClient, DockerRuntimeAdapter } from "./docker"
import { snapshotBuildFiles } from "./image-build"

const owner: RuntimeOwnership = {
  backendId: "backend",
  projectId: "project",
  runtimeId: "runtime",
  workloadId: "workload",
  generation: 1,
  kind: "terminal",
}
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>(resolve => server.close(() => resolve()))
})

describe("Docker API adapter", () => {
  it("uses the configured remote API, transfers archive bytes, and preserves bridge aliases", async () => {
    const requests: { method: string; path: string; body: Buffer }[] = []
    const labels: Record<string, string> = {}
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      const url = new URL(request.url!, "http://localhost")
      requests.push({ method: request.method!, path: url.pathname, body })
      response.setHeader("Content-Type", "application/json")
      const path = url.pathname.replace(/^\/v[\d.]+/, "")
      if (path === "/containers/json") return response.end("[]")
      if (path === "/networks/bridge-operation")
        return response.end(JSON.stringify({ Id: "bridge-operation", Containers: {} }))
      if (path === "/images/example/json")
        return response.end(
          JSON.stringify({ Id: "sha256:image", RepoDigests: [], Config: { Labels: {} } }),
        )
      if (path === "/containers/create") {
        Object.assign(labels, JSON.parse(body.toString()).Labels)
        response.statusCode = 201
        return response.end('{"Id":"container"}')
      }
      if (path === "/containers/container/json")
        return response.end(
          JSON.stringify({ Config: { Labels: labels }, State: { Running: true, ExitCode: 0 } }),
        )
      response.statusCode = path.endsWith("/archive") ? 200 : 204
      return response.end()
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const address = server.address() as { port: number }
    const adapter = new DockerRuntimeAdapter({
      endpoint: `http://127.0.0.1:${address.port}`,
      local: false,
    })
    const result = await adapter.place({
      owner,
      image: "example",
      command: ["sh"],
      args: ["-c", "sleep 10"],
      environment: { id: "bridge-operation", owner },
      aliases: ["stable.resource.example"],
      files: [{ path: "config/value", data: Buffer.from("portable bytes") }],
    })
    expect(result.state).toBe("running")
    const create = requests.find(request => request.path.endsWith("/containers/create"))!
    const declaration = JSON.parse(create.body.toString())
    expect(declaration.NetworkingConfig.EndpointsConfig["bridge-operation"].Aliases).toEqual([
      "stable.resource.example",
    ])
    expect(declaration.HostConfig.NetworkMode).toBeUndefined()
    expect(declaration.Labels["highstate.io/project"]).toBe("project")
    const archive = requests.find(request =>
      request.path.endsWith("/containers/container/archive"),
    )!
    expect(archive.body.includes(Buffer.from("portable bytes"))).toBe(true)
    await expect(
      adapter.place({
        owner,
        image: "example",
        localBinds: [{ source: "/backend", target: "/data" }],
      }),
    ).rejects.toThrow(/backend-host/)
  })

  it("configures independent client TLS and unix socket endpoints", () => {
    const local = createDockerClient({ endpoint: "unix:///run/custom.sock", local: true })
    expect((local.modem as unknown as { socketPath: string }).socketPath).toBe("/run/custom.sock")
    const remote = createDockerClient({
      endpoint: "tcp://engine.example:2376",
      local: false,
      tls: { ca: "ca", cert: "cert", key: "key" },
    })
    expect(remote.modem).toMatchObject({
      protocol: "https",
      host: "engine.example",
      ca: "ca",
      cert: "cert",
      key: "key",
    })
  })

  it("requires immutable bases and frozen inputs, and excludes credentials from the context", () => {
    const request: ImageBuildRequest = {
      owner,
      snapshotId: "snapshot",
      snapshotHash: "hash",
      baseImage: `runner@sha256:${"a".repeat(64)}`,
      files: [
        { path: "package.json", data: Buffer.from('{"dependencies":{"example":"1.0.0"}}') },
        { path: "bun.lock", data: Buffer.from("lock") },
      ],
      secrets: [{ path: "npmrc", data: Buffer.from("token=secret"), secret: true }],
    }
    const files = snapshotBuildFiles(request)
    const dockerfile = Buffer.from(files.find(file => file.path === "Dockerfile")!.data).toString()
    expect(dockerfile).toContain("--frozen-lockfile")
    expect(dockerfile).toContain("--mount=type=secret,id=npmrc")
    expect(files.some(file => Buffer.from(file.data).includes(Buffer.from("token=secret")))).toBe(
      false,
    )
    expect(() => snapshotBuildFiles({ ...request, baseImage: "runner:latest" })).toThrow(/pinned/)
    expect(() =>
      snapshotBuildFiles({
        ...request,
        files: [...request.files, { path: ".npmrc", data: Buffer.from("token") }],
      }),
    ).toThrow(/credentials/)
    expect(() => snapshotBuildFiles({ ...request, files: [] })).toThrow(/lockfile/)
  })
})

describe.skipIf(process.env.HIGHSTATE_RUNTIME_DOCKER_SMOKE !== "true")(
  "real Docker runtime smoke",
  () => {
    it("places, transfers files, execs, resizes, attaches, discovers and cleans up twice", async () => {
      const endpoint =
        process.env.HIGHSTATE_RUNTIME_DOCKER_ENDPOINT ?? "unix:///var/run/docker.sock"
      const adapter = new DockerRuntimeAdapter({
        endpoint,
        local: endpoint.startsWith("unix:"),
        secretHelperImage: "oven/bun:1.3.13-debian",
      })
      const smokeOwner = { ...owner, workloadId: randomUUID() }
      const volume = { name: `hs-smoke-${smokeOwner.workloadId}`, mountPath: "/persistent" }
      const image = process.env.HIGHSTATE_RUNTIME_DOCKER_IMAGE ?? "oven/bun:1.3.13-debian"
      try {
        expect((await adapter.preflight())[0]?.ok).toBe(true)
        const environment = await adapter.createEnvironment(smokeOwner)
        const intent = {
          owner: smokeOwner,
          image,
          command: ["sh", "-c"],
          args: ["cat /message; sleep 90"],
          tty: true,
          environment,
          aliases: ["caller.owned.alias"],
          volumes: [volume],
          files: [
            { path: "message", data: Buffer.from("runtime-smoke\n") },
            { path: "run/highstate/token", data: Buffer.from("runtime-secret"), secret: true },
          ],
        }
        const root = await adapter.place(intent)
        expect((await adapter.place(intent)).id).toBe(root.id)
        await expect(adapter.place({ ...intent, args: ["different"] })).rejects.toThrow(
          /declaration/,
        )
        const execution = await adapter.exec(
          root.id,
          [
            "sh",
            "-c",
            "cat /message; cat /run/highstate/token; getent hosts caller.owned.alias; echo volume > /persistent/value",
          ],
          { tty: false },
        )
        const chunks: Buffer[] = []
        const read = (async () => {
          for await (const chunk of execution.stream) chunks.push(Buffer.from(chunk))
        })()
        expect(await execution.completed).toBe(0)
        await read
        expect(Buffer.concat(chunks).toString()).toContain("runtime-smoke")
        expect(Buffer.concat(chunks).toString()).toContain("runtime-secret")
        expect(Buffer.concat(chunks).toString()).toContain("caller.owned.alias")
        const session = await adapter.attach(root.id)
        session.stream.resume()
        await session.resize(100, 30)
        session.close()
        expect(
          await adapter.discover({ "highstate.io/workload": smokeOwner.workloadId }),
        ).toHaveLength(1)
        await adapter.stop(root.id)
        const logs: Buffer[] = []
        for await (const log of adapter.logs(root.id)) logs.push(Buffer.from(log.data))
        expect(Buffer.concat(logs).toString()).toContain("runtime-smoke")
        await adapter.cleanup(smokeOwner)
        await adapter.cleanup(smokeOwner)
        expect(
          await adapter.discover({ "highstate.io/workload": smokeOwner.workloadId }),
        ).toHaveLength(0)
      } finally {
        await adapter.cleanup(smokeOwner)
        await adapter.removeVolume(smokeOwner, volume.name)
      }
    }, 120_000)

    it("builds and verifies a frozen snapshot with an immutable base through the engine API", async () => {
      const endpoint =
        process.env.HIGHSTATE_RUNTIME_DOCKER_ENDPOINT ?? "unix:///var/run/docker.sock"
      const adapter = new DockerRuntimeAdapter({ endpoint, local: endpoint.startsWith("unix:") })
      const client = createDockerClient({ endpoint, local: true })
      const base = await adapter.ensureImage(
        process.env.HIGHSTATE_RUNTIME_DOCKER_IMAGE ?? "oven/bun:1.3.13-debian",
      )
      const buildOwner = { ...owner, workloadId: randomUUID(), kind: "library_build" as const }
      const phases: string[] = []
      let reference: string | undefined
      try {
        const image = await adapter.buildImage(
          {
            owner: buildOwner,
            snapshotId: "empty",
            snapshotHash: "smoke-hash",
            baseImage: base.reference,
            files: [
              {
                path: "package.json",
                data: Buffer.from(
                  '{"name":"highstate-snapshot","private":true,"dependencies":{"is-number":"7.0.0"}}',
                ),
              },
              {
                path: "bun.lock",
                data: Buffer.from(
                  '{"lockfileVersion":1,"configVersion":1,"workspaces":{"":{"name":"highstate-snapshot","dependencies":{"is-number":"7.0.0"}}},"packages":{"is-number":["is-number@7.0.0","",{},"sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng=="]}}',
                ),
              },
            ],
            secrets: [
              {
                path: "npmrc",
                data: Buffer.from("registry=https://registry.npmjs.org\n# build-secret-smoke\n"),
                secret: true,
              },
            ],
          },
          async phase => {
            phases.push(phase)
          },
        )
        reference = image.reference
        expect(await adapter.verifyImage(image)).toBe(true)
        expect(image.imageHash).toBe("smoke-hash")
        expect(phases).toContain("verifying")
      } finally {
        await adapter.cleanup(buildOwner)
        if (reference) await client.getImage(reference).remove({ force: true })
        // remove any failed build's tagged image as well
        const images = await client.listImages({
          filters: JSON.stringify({ label: [`highstate.io/workload=${buildOwner.workloadId}`] }),
        })
        for (const image of images) await client.getImage(image.Id).remove({ force: true })
      }
    }, 120_000)
  },
)

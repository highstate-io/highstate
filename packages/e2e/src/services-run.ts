import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startDesigner } from "./browser/designer"
import { startBackend } from "./harness/backend"
import { createClients } from "./harness/clients"
import { startEffects } from "./harness/effects"
import { cleanupProjectResources, createEnvironment } from "./harness/environment"
import { command } from "./harness/process"
import { createProject } from "./harness/project"
import { startRegistry } from "./harness/registry"
import { workloadServices } from "./scenarios/workload-services"

const root = Bun.fileURLToPath(new URL("../../..", import.meta.url))
const environment = await createEnvironment()
let failure: unknown
try {
  const registry = await startRegistry({ publicHost: environment.host })
  environment.cleanup.add(async () => await registry.cleanup())
  const effects = startEffects(environment.host)
  environment.cleanup.add(async () => await effects.stop())

  environment.cleanup.add(
    async () => await cleanupProjectResources(environment.projectId, environment.evidence),
  )

  const backend = await startBackend(environment)
  environment.cleanup.add(async () => await backend.stop())

  const projectId = await createProject(
    createClients(backend.url, backend.token),
    environment,
    registry.url,
  )

  await backend.stop()

  let designerUrl = ""

  // route the advertised public API through the real Designer API-host middleware
  const proxy = Bun.serve({
    hostname: "0.0.0.0",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const headers = new Headers(request.headers)
      headers.set("host", `api.highstate.localhost:${new URL(designerUrl).port}`)
      headers.delete("content-length")
      headers.delete("transfer-encoding")
      headers.delete("connection")
      return await fetch(`${designerUrl}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body:
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : await request.arrayBuffer(),
        redirect: "manual",
      })
    },
  })

  environment.cleanup.add(async () => await proxy.stop(true))

  const designer = await startDesigner({
    directory: environment.directory,
    env: {
      HIGHSTATE_PUBLIC_API_URL: `http://${environment.host}:${proxy.port}`,
      HIGHSTATE_RUNTIME_TLS_CERT_PATH: join(environment.directory, "cert.pem"),
      HIGHSTATE_RUNTIME_TLS_KEY_PATH: join(environment.directory, "key.pem"),
      HIGHSTATE_RUNTIME_HOST: "0.0.0.0",
      HIGHSTATE_RUNTIME_PORT: String(environment.runtimePort),
      HIGHSTATE_RUNNER_BASE_IMAGE: environment.runnerImage,
      NITRO_HOST: "0.0.0.0",
    },
  })

  designerUrl = designer.url

  environment.cleanup.add(async () => {
    await designer.stop()
    await environment.evidence.write("designer.log", designer.logs())
  })

  const clients = createClients(`http://127.0.0.1:${proxy.port}`, backend.token)
  await clients.project.unlockProject({ projectId, decryptedIdentity: "" })

  const worker = join(environment.directory, "worker.js")

  await command([
    "bun",
    "build",
    join(root, "packages/e2e/fixtures/worker.ts"),
    "--target=bun",
    "--external=@grpc/grpc-js",
    `--outfile=${worker}`,
  ])

  const dockerfile = join(environment.directory, "Dockerfile")

  await writeFile(
    dockerfile,
    'FROM highstate-e2e-runner:build\nCOPY worker.js /opt/highstate/runtime-agent/fixture-worker.js\nENTRYPOINT ["bun", "/opt/highstate/runtime-agent/fixture-worker.js"]\n',
  )

  const workerTag = `${environment.runnerImage.split("/")[0]}/highstate-e2e-worker:${environment.runId}`

  await command(["docker", "build", "-t", workerTag, environment.directory], {
    evidence: environment.evidence,
    name: "worker-build.log",
  })

  environment.cleanup.add(
    async () => await command(["docker", "image", "rm", "-f", workerTag]).then(() => {}),
  )

  await command(["docker", "push", workerTag])

  const workerImage = JSON.parse(
    await command(["docker", "image", "inspect", workerTag, "--format", "{{json .RepoDigests}}"]),
  )[0] as string

  await workloadServices(clients, environment, effects, projectId, designerUrl, workerImage)

  await environment.evidence.write("result.json", {
    status: "passed",
    scenarios: ["workload-services"],
  })

  console.log(`Workload services passed; evidence: ${environment.evidence.directory}`)
} catch (error) {
  failure = error

  await environment.evidence.write("result.json", {
    status: "failed",
    error: error instanceof Error ? error.stack : String(error),
  })
} finally {
  try {
    await environment.cleanup.run()
  } catch (error) {
    failure = new AggregateError(
      [failure, error].filter(Boolean),
      "Workload services or cleanup failed",
    )
  }
}
if (failure) {
  throw failure
}

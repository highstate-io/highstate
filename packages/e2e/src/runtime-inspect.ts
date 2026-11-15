import { join } from "node:path"
import { ComponentKind, OperationType } from "@highstate/api/v1"
import { startBackend } from "./harness/backend"
import { createClients } from "./harness/clients"
import { startDesigner } from "./harness/designer"
import { startEffects } from "./harness/effects"
import { cleanupProjectResources, createEnvironment } from "./harness/environment"
import { inspectDesigner } from "./harness/inspection"
import { createProject } from "./harness/project"
import { startRegistry } from "./harness/registry"
import { argumentsFor, runOperation } from "./scenarios/lifecycle"

const environment = await createEnvironment()

try {
  const registry = await startRegistry({ publicHost: environment.host })
  environment.cleanup.add(async () => await registry.cleanup())
  const effects = startEffects(environment.host)
  environment.cleanup.add(async () => await effects.stop())

  console.log(`Container callbacks: TLS runtime port ${environment.runtimePort}`)
  console.log(`Fixture registry: ${registry.url}; resource service: ${effects.url}`)

  environment.cleanup.add(
    async () => await cleanupProjectResources(environment.projectId, environment.evidence),
  )

  const backend = await startBackend(environment)
  environment.cleanup.add(async () => await backend.stop())
  const clients = createClients(backend.url, backend.token)
  const projectId = await createProject(clients, environment, registry.url)

  await clients.library.addLibraryPackage({
    projectId,
    packageName: "@highstate/e2e-library",
    version: "1.0.0",
  })

  const fixtures = [
    ["deployed", "deployed-value"],
    ["drifted", "original-value"],
    ["ready", "not-deployed-yet"],
    ["failure", "unreachable-endpoint"],
  ] as const

  await clients.model.createNodes({
    projectId,
    instances: [
      ...fixtures.map(([name, value], index) => ({
        id: `e2e.marker.v1:${name}`,
        kind: ComponentKind.UNIT,
        type: "e2e.marker.v1",
        name,
        position: { x: (index % 2) * 500, y: Math.floor(index / 2) * 350 },
        arguments: argumentsFor(
          name === "failure" ? `http://${environment.host}:1` : effects.url,
          name,
          value,
        ),
      })),
    ],
  })

  await runOperation(
    clients,
    environment,
    projectId,
    ["e2e.marker.v1:deployed", "e2e.marker.v1:drifted"],
    OperationType.UPDATE,
  )

  effects.resources.set("drifted", {
    ...effects.resources.get("drifted"),
    value: "externally-modified",
  })

  await clients.model.createNodes({
    projectId,
    instances: [
      {
        id: "e2e.composite.v1:composite",
        kind: ComponentKind.COMPOSITE,
        type: "e2e.composite.v1",
        name: "composite",
        position: { x: 1000, y: 0 },
        arguments: argumentsFor(effects.url, "composite", "expanded-child"),
      },
    ],
  })

  await clients.library.updateLibraryPackage({
    projectId,
    packageName: "@highstate/e2e-library",
    version: "2.0.0",
  })

  await backend.stop()

  let designerUrl = ""

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
        body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
        redirect: "manual",
      })
    },
  })

  environment.cleanup.add(async () => await proxy.stop(true))

  const designer = await startDesigner({
    directory: environment.directory,
    mode: "development",
    env: {
      HIGHSTATE_INITIAL_LIBRARY_PACKAGES: "[]",
      HIGHSTATE_RUNNER_BASE_IMAGE: environment.runnerImage,
      HIGHSTATE_RUNTIME_TLS_CERT_PATH: join(environment.directory, "cert.pem"),
      HIGHSTATE_RUNTIME_TLS_KEY_PATH: join(environment.directory, "key.pem"),
      HIGHSTATE_RUNTIME_HOST: "0.0.0.0",
      HIGHSTATE_RUNTIME_PORT: String(environment.runtimePort),
      HIGHSTATE_PUBLIC_API_URL: `http://${environment.host}:${proxy.port}`,
    },
  })

  designerUrl = designer.url
  environment.cleanup.add(async () => await designer.stop())

  await createClients(`http://127.0.0.1:${proxy.port}`, backend.token).project.unlockProject({
    projectId,
    decryptedIdentity: "",
  })

  await inspectDesigner(designer, [projectId])
} finally {
  await environment.cleanup.run()
}

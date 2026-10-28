import { OperationType } from "@highstate/api/v1"
import { startBackend } from "./harness/backend"
import { createClients } from "./harness/clients"
import { startEffects } from "./harness/effects"
import { cleanupProjectResources, createEnvironment } from "./harness/environment"
import { command } from "./harness/process"
import { createProject } from "./harness/project"
import { startRegistry } from "./harness/registry"
import { lifecycle, runOperation } from "./scenarios/lifecycle"
import { resilience } from "./scenarios/resilience"
import { upgrade } from "./scenarios/upgrade"

const root = Bun.fileURLToPath(new URL("../../..", import.meta.url))
await command(
  [
    "bunx",
    "--bun",
    "nx",
    "run-many",
    "-t",
    "build",
    "--projects=@highstate/backend,@highstate/backend-api,@highstate/pulumi",
    "--parallel=2",
  ],
  { cwd: root },
)
const environment = await createEnvironment()
let failure: unknown
try {
  const registry = await startRegistry({ publicHost: environment.host })
  environment.cleanup.add(async () => {
    await registry.cleanup()
  })
  const effects = startEffects(environment.host)
  environment.cleanup.add(async () => {
    await effects.stop()
  })
  environment.cleanup.add(async () => {
    await cleanupProjectResources(environment.projectId, environment.evidence)
  })
  let backend = await startBackend(environment)
  environment.cleanup.add(async () => {
    await backend.stop()
  })
  let clients = createClients(backend.url, backend.token)
  console.log("E2E: configuring runtime and creating project")
  const projectId = await createProject(clients, environment, registry.url)
  console.log("E2E: running packaged Pulumi lifecycle")
  const result = await lifecycle(clients, environment, effects, projectId)
  console.log("E2E: cancelling and recovering actual in-flight Pulumi operations")
  clients = await resilience(
    clients,
    environment,
    effects,
    projectId,
    result.instanceId,
    async () => {
      await backend.stop(true)
      backend = await startBackend({ ...environment, logName: "backend-restarted.log" })
      return createClients(backend.url, backend.token)
    },
  )
  await runOperation(clients, environment, projectId, result.instanceIds, OperationType.DESTROY)
  await environment.evidence.write("effects.json", effects.events)
  if (effects.resources.size)
    throw new Error(
      `Destroy left external fixture resources: ${JSON.stringify([...effects.resources])}`,
    )
  await backend.stop()
  console.log("E2E: migrating databases populated by the published previous release")
  await upgrade(environment)
  await environment.evidence.write("result.json", {
    status: "passed",
    scenarios: ["lifecycle", "cancellation", "restart-recovery", "populated-release-upgrade"],
  })
  console.log(`E2E passed; evidence: ${environment.evidence.directory}`)
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
    failure = new AggregateError([failure, error].filter(Boolean), "E2E or cleanup failed")
  }
}
if (failure) throw failure

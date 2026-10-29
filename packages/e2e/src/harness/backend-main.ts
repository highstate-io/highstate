import { readFile, writeFile } from "node:fs/promises"
import {
  type BackendRequestContext,
  createServices,
  disposeServices,
  loadConfig,
} from "@highstate/backend"
import { backendPermissionGroups } from "@highstate/backend/shared"
import { startBackendApi } from "@highstate/backend-api"

process.on("uncaughtException", (error, origin) => {
  console.error("backend uncaught exception", origin, error.stack)
  process.exit(1)
})
process.on("unhandledRejection", error => {
  console.error("backend unhandled rejection", error instanceof Error ? error.stack : error)
  process.exit(1)
})

const services = await createServices({ config: await loadConfig(process.env, false) })
services.logger.info("e2e: provisioning backend credentials")
const credentialsPath = process.env.HIGHSTATE_E2E_CREDENTIALS!
try {
  await readFile(credentialsPath)
} catch {
  // the embedding host provisions its isolated administrator through the same service as the cli
  const context: BackendRequestContext = {
    realm: "backend",
    subject: { type: "user", userId: "e2e-host", groupIds: [] },
    permissions: new Map(
      backendPermissionGroups.flatMap(group =>
        group.permissions.map(permission => [permission.name, [{ restrictions: [] }]] as const),
      ),
    ),
  }

  const credential = await services.backendApiKeySettingsService.create(context, {
    meta: { title: "E2E isolated administrator" },
    restrictionRules: [],
    expiresAt: null,
  })

  await writeFile(credentialsPath, credential.token, { mode: 0o600 })
}
services.logger.info("e2e: starting backend api listeners")
const api = await startBackendApi(services, {
  address: process.env.HIGHSTATE_E2E_API_URL!,
  workerSocketPath: process.env.HIGHSTATE_E2E_WORKER_SOCKET!,
})
services.logger.info("e2e: backend api ready")
process.send?.({ ready: true, address: api.address })
process.on("SIGTERM", async () => {
  await api.shutdown()
  await disposeServices(services)
  process.exit(0)
})

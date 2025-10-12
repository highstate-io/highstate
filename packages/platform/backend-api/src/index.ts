import type { Services } from "@highstate/backend"
import { rm } from "node:fs/promises"
import { InstanceServiceDefinition } from "@highstate/api/instance.v1"
import { SecretServiceDefinition } from "@highstate/api/secret.v1"
import { WorkerServiceDefinition } from "@highstate/api/worker.v1"
import { createServer } from "nice-grpc"
import { createInstanceService } from "./handlers/instance"
import { createSecretService } from "./handlers/secret"
import { createWorkerService } from "./handlers/worker"
import { createErrorHandlingMiddleware } from "./shared"

export async function startBackedApi(services: Services) {
  const server = createServer()
  server.use(createErrorHandlingMiddleware(services))

  server.add(InstanceServiceDefinition, createInstanceService(services))
  server.add(SecretServiceDefinition, createSecretService(services))
  server.add(WorkerServiceDefinition, createWorkerService(services))

  const uid = process.geteuid?.()
  const sockPath = `/run/user/${uid}/highstate.sock`

  try {
    await rm(sockPath, { force: true })
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      services.logger.error({ error }, "failed to remove existing socket file")
    }
  }

  await server.listen(`unix:${sockPath}`)

  services.workerManager.config.HIGHSTATE_WORKER_API_PATH = sockPath
  services.logger.info(`api listening at %s`, sockPath)
}

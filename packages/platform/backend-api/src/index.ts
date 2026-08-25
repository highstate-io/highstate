import type { Services } from "@highstate/backend"
import { rm } from "node:fs/promises"
import { createServer, type RequestListener, type Server } from "node:http"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import {
  InstanceStateService,
  LibraryService,
  OperationService,
  PanelService,
  ProjectModelService,
  ProjectService,
  SecretService,
} from "@highstate/api/v1"
import { WorkerService } from "@highstate/api/worker.v1"
import { createInstanceStateService } from "./handlers/instance-state"
import { createLibraryService } from "./handlers/library"
import { createOperationService } from "./handlers/operation"
import { createPanelService } from "./handlers/panel"
import { createProjectService } from "./handlers/project"
import { createProjectModelService } from "./handlers/project-model"
import { createSecretService } from "./handlers/secret"
import { createWorkerService } from "./handlers/worker"
import { createErrorHandlingInterceptor } from "./shared"

export type BackendApiOptions = {
  address?: string
  workerSocketPath?: string
}

export type BackendApiHandlerOptions = {
  requestPathPrefix?: string
}

export type BackendApi = {
  address: string
  shutdown(): Promise<void>
}

/**
 * Creates a Node.js handler for the public Highstate Connect API.
 *
 * @param services The backend services used by the API handlers.
 * @param options The API handler options.
 * @returns A Node.js request listener serving the public API.
 */
export function createBackendApiHandler(
  services: Services,
  options: BackendApiHandlerOptions = {},
): RequestListener {
  return connectNodeAdapter({
    interceptors: [createErrorHandlingInterceptor(services)],
    requestPathPrefix: options.requestPathPrefix,
    routes(router) {
      router.service(InstanceStateService, createInstanceStateService(services))
      router.service(LibraryService, createLibraryService(services))
      router.service(OperationService, createOperationService(services))
      router.service(PanelService, createPanelService(services))
      router.service(ProjectModelService, createProjectModelService(services))
      router.service(ProjectService, createProjectService(services))
      router.service(SecretService, createSecretService(services))
      router.service(WorkerService, createWorkerService(services))
    },
  })
}

/**
 * Starts the public Highstate Connect API.
 *
 * @param services The backend services used by the API handlers.
 * @param options The API listen and worker socket options.
 * @returns The running API and its lifecycle controls.
 */
export async function startBackendApi(
  services: Services,
  options: BackendApiOptions = {},
): Promise<BackendApi> {
  const uid = process.geteuid?.()
  const workerSocketPath = options.workerSocketPath ?? `/run/user/${uid}/highstate.sock`
  const workerAddress = `unix:${workerSocketPath}`
  const address = options.address ?? workerAddress
  const addresses = address === workerAddress ? [workerAddress] : [workerAddress, address]
  const handler = createBackendApiHandler(services)
  const servers = addresses.map(() => createServer(handler))

  try {
    await rm(workerSocketPath, { force: true })
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      services.logger.error({ error }, "failed to remove existing socket file")
    }
  }

  try {
    for (const [index, server] of servers.entries()) {
      const serverAddress = addresses[index]!
      await listen(server, serverAddress)
      services.logger.info(`api listening at "%s"`, serverAddress)
    }
  } catch (error) {
    await Promise.allSettled(servers.map(close))
    await rm(workerSocketPath, { force: true })
    throw new Error("Failed to start backend api", { cause: error })
  }

  services.workerManager.config.HIGHSTATE_WORKER_API_PATH = workerSocketPath

  return {
    address,
    async shutdown() {
      await Promise.all(servers.map(close))
      await rm(workerSocketPath, { force: true })
    },
  }
}

async function listen(server: Server, address: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.once("listening", resolve)

    if (address.startsWith("unix:")) {
      server.listen(address.slice("unix:".length))
      return
    }

    const url = new URL(address.includes("://") ? address : `http://${address}`)
    server.listen(Number(url.port), url.hostname)
  })
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
    server.closeAllConnections()
  })
}

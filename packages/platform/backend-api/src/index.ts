import type { Services } from "@highstate/backend"
import { rm } from "node:fs/promises"
import { createServer, type RequestListener, type Server } from "node:http"
import { create } from "@bufbuild/protobuf"
import { type ConnectRouter, createConnectRouter } from "@connectrpc/connect"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import { ProxyWorkerResponseSchema } from "@highstate/api/runtime.v1"
import {
  InstanceStateService,
  LibraryService,
  OperationService,
  PanelService,
  ProjectModelService,
  ProjectService,
  RuntimeSettingsService,
  SecretService,
} from "@highstate/api/v1"
import { WorkerService } from "@highstate/api/worker.v1"
import { createWorkerProxyHandler } from "@highstate/backend"
import { createInstanceStateService } from "./handlers/instance-state"
import { createLibraryService } from "./handlers/library"
import { createOperationService } from "./handlers/operation"
import { createPanelService } from "./handlers/panel"
import { createProjectService } from "./handlers/project"
import { createProjectModelService } from "./handlers/project-model"
import { createRuntimeSettingsService } from "./handlers/runtime-settings"
import { createSecretService } from "./handlers/secret"
import { createWorkerService } from "./handlers/worker"
import {
  loadRuntimeListenerOptions,
  type RuntimeListenerOptions,
  type RuntimeServer,
  startRuntimeServer,
} from "./runtime-server"
import { createErrorHandlingInterceptor } from "./shared"

export {
  loadRuntimeListenerOptions,
  type RuntimeListenerOptions,
  startRuntimeServer,
} from "./runtime-server"

export type BackendApiOptions = {
  address?: string
  workerSocketPath?: string
  /**
   * Dedicated TLS listener configuration; defaults to HIGHSTATE_RUNTIME_* environment variables.
   */
  runtime?: RuntimeListenerOptions | false
}

export type BackendApiHandlerOptions = {
  requestPathPrefix?: string
}

export interface BackendApi {
  address: string
  runtimeAddress?: RuntimeServer["address"]
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
    routes: router => registerServices(router, services),
  })
}

function registerServices(router: ConnectRouter, services: Services): void {
  router.service(InstanceStateService, createInstanceStateService(services))
  router.service(LibraryService, createLibraryService(services))
  router.service(OperationService, createOperationService(services))
  router.service(PanelService, createPanelService(services))
  router.service(ProjectModelService, createProjectModelService(services))
  router.service(ProjectService, createProjectService(services))
  router.service(SecretService, createSecretService(services))
  router.service(RuntimeSettingsService, createRuntimeSettingsService(services))
  router.service(WorkerService, createWorkerService(services))
}

/**
 * Adapts the public API to Fetch hosts whose Node.js request objects are compatibility shims.
 * Request and response bodies retain streaming and cancellation semantics.
 */
export function createBackendApiFetchHandler(
  services: Services,
): (request: Request) => Promise<Response> {
  const router = createConnectRouter({ interceptors: [createErrorHandlingInterceptor(services)] })
  registerServices(router, services)
  const handlers = new Map(router.handlers.map(handler => [handler.requestPath, handler]))
  return async request => {
    const handler = handlers.get(new URL(request.url).pathname)
    if (!handler) {
      return new Response(null, { status: 404 })
    }

    const response = await handler({
      httpVersion: "1.1",
      method: request.method,
      url: request.url,
      header: request.headers,
      signal: request.signal,
      body: (async function* () {
        if (!request.body) {
          return
        }

        const reader = request.body.getReader()

        try {
          for (;;) {
            const next = await reader.read()
            if (next.done) {
              return
            }

            yield next.value
          }
        } finally {
          reader.releaseLock()
        }
      })(),
    })

    const iterator = response.body?.[Symbol.asyncIterator]()

    const body = iterator
      ? new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const next = await iterator.next()
              if (next.done) {
                controller.close()
              } else {
                controller.enqueue(next.value)
              }
            } catch (error) {
              controller.error(error)
            }
          },
          async cancel() {
            await iterator.return?.()
          },
        })
      : null

    return new Response(body, { status: response.status, headers: response.header })
  }
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
  const runtimeOptions =
    options.runtime === false
      ? undefined
      : (options.runtime ?? (await loadRuntimeListenerOptions()))

  const uid = process.geteuid?.()
  const workerSocketPath = options.workerSocketPath ?? `/run/user/${uid}/highstate.sock`
  const workerAddress = `unix:${workerSocketPath}`
  const address = options.address ?? workerAddress
  const addresses = address === workerAddress ? [workerAddress] : [workerAddress, address]
  const handler = createBackendApiHandler(services)
  const servers = addresses.map(() => createServer(handler))
  let runtime: RuntimeServer | undefined

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

    if (runtimeOptions) {
      runtime = await startRuntimeServer(services.runtimeCoordinator, {
        ...runtimeOptions,
        artifacts: services.runtimeArtifactTransfer,
        proxyWorker: createWorkerProxyHandler(
          services.runtimeCoordinator,
          services.workerProxyRegistry,
          services.runtimeCredentialSigner,
          frame => create(ProxyWorkerResponseSchema, frame),
        ),
      })

      services.logger.info({ address: runtime.address }, "runtime tls api listening")
    }
  } catch (error) {
    await runtime?.shutdown()
    await Promise.allSettled(servers.map(close))
    await rm(workerSocketPath, { force: true })
    throw new Error("Failed to start backend api", { cause: error })
  }

  return {
    address,
    runtimeAddress: runtime?.address,
    async shutdown() {
      await Promise.all([...servers.map(close), runtime?.shutdown()])
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

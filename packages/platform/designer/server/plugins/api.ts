import { getSharedServices } from "@highstate/backend"
import { startBackendApi } from "@highstate/backend-api"
import { ensureLocalBackendUser } from "../authentication"

export default defineNitroPlugin(async _app => {
  const services = await getSharedServices()
  await ensureLocalBackendUser(services)

  services.logger.debug("starting backend api")

  await startBackendApi(services, {
    workerSocketPath: process.env.HIGHSTATE_DESIGNER_WORKER_SOCKET_PATH,
  })

  const port = process.env.HIGHSTATE_DESIGNER_PORT ?? process.env.NITRO_PORT ?? "7283"
  services.logger.info(`grpc api listening at "%s"`, `http://api.highstate.localhost:${port}`)

  // apply per-method startup choices and development overrides
  await services.projectUnlockService.autoUnlockProjects()
})

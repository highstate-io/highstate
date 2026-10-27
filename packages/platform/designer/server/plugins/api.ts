import { getSharedServices } from "@highstate/backend"
import { startBackendApi } from "@highstate/backend-api"
import { ensureLocalBackendUser } from "../authentication"
import { isHostedAuth } from "../utils/auth-config"
import { initializeHostedAuth } from "../utils/auth-initialization"

export default defineNitroPlugin(async _app => {
  const services = await getSharedServices()
  if (isHostedAuth()) await initializeHostedAuth(services)
  else await ensureLocalBackendUser(services)

  services.logger.debug("starting backend api")
  await startBackendApi(services)

  const port = process.env.HIGHSTATE_DESIGNER_PORT ?? process.env.NITRO_PORT ?? "7283"
  services.logger.info(`grpc api listening at "%s"`, `http://api.highstate.localhost:${port}`)

  // auto-unlock projects for development environment
  await services.projectUnlockService.autoUnlockProjects()
})

import { getSharedServices } from "@highstate/backend"
import { startBackendApi } from "@highstate/backend-api"
import { ensureLocalBackendUser } from "../authentication"

export default defineNitroPlugin(async app => {
  const services = await getSharedServices()
  await ensureLocalBackendUser(services)

  services.logger.debug("starting backend api")
  await startBackendApi(services)

  const port = process.env.HIGHSTATE_DESIGNER_PORT ?? process.env.NITRO_PORT ?? "7283"
  services.logger.info(`grpc api listening at "%s"`, `http://api.highstate.localhost:${port}`)
  services.logger.info(`mcp api listening at "%s"`, `http://api.highstate.localhost:${port}/mcp`)

  // auto-unlock projects for development environment
  await services.projectUnlockService.autoUnlockProjects()
})

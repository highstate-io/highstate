import { getSharedServices } from "@highstate/backend"
import { startBackedApi } from "@highstate/backend-api"

export default defineNitroPlugin(async app => {
  const services = await getSharedServices()

  services.logger.debug("starting backend api")
  await startBackedApi(services)

  // auto-unlock projects for development environment
  await services.projectUnlockService.autoUnlockProjects()
})

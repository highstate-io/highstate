import { getSharedServices } from "@highstate/backend"
import { createBackendApiFetchHandler } from "@highstate/backend-api"

const apiHostname = "api.highstate.localhost"

const apiHandlers = (async () => {
  const services = await getSharedServices()
  const grpcHandler = createBackendApiFetchHandler(services)
  return { grpcHandler }
})()

export default defineEventHandler(async event => {
  if (getRequestURL(event).hostname !== apiHostname) {
    return
  }

  const { grpcHandler } = await apiHandlers

  return await grpcHandler(toWebRequest(event))
})

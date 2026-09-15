import { getSharedServices } from "@highstate/backend"
import { createBackendApiHandler } from "@highstate/backend-api"

const apiHostname = "api.highstate.localhost"

const apiHandlers = (async () => {
  const services = await getSharedServices()
  const grpcHandler = createBackendApiHandler(services)
  return { grpcHandler }
})()

export default defineEventHandler(async event => {
  if (getRequestURL(event).hostname !== apiHostname) {
    return
  }

  const { grpcHandler } = await apiHandlers

  await new Promise<void>((resolve, reject) => {
    event.node.res.once("finish", resolve)
    event.node.res.once("close", resolve)
    event.node.res.once("error", reject)

    grpcHandler(event.node.req, event.node.res)
  })
})

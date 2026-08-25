import { getSharedServices } from "@highstate/backend"
import { createBackendApiHandler } from "@highstate/backend-api"
import { createHighstateMcpHandler } from "@highstate/mcp"

const apiHostname = "api.highstate.localhost"

const apiHandlers = (async () => {
  const services = await getSharedServices()
  const grpcHandler = createBackendApiHandler(services)
  const uid = process.geteuid?.()
  const mcpHandler = createHighstateMcpHandler({
    apiUrl: `unix:///run/user/${uid}/highstate.sock`,
  })

  return { grpcHandler, mcpHandler }
})()

export default defineEventHandler(async event => {
  if (getRequestURL(event).hostname !== apiHostname) {
    return
  }

  const { grpcHandler, mcpHandler } = await apiHandlers
  if (event.path === "/mcp" || event.path.startsWith("/mcp/")) {
    return await mcpHandler(toWebRequest(event))
  }

  await new Promise<void>((resolve, reject) => {
    event.node.res.once("finish", resolve)
    event.node.res.once("close", resolve)
    event.node.res.once("error", reject)

    grpcHandler(event.node.req, event.node.res)
  })
})

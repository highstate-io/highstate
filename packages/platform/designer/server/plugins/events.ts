import { WebSocketServer } from "ws"
import { appRouter } from "../router"
import { applyWSSHandler } from "@trpc/server/adapters/ws"
import { getSharedServices } from "@highstate/backend"

export default defineNitroPlugin(async nitro => {
  const config = useRuntimeConfig()
  const wss = new WebSocketServer({ port: config.public.eventsPort })
  const { logger } = await getSharedServices()

  const handler = applyWSSHandler({
    wss,
    router: appRouter,
    createContext: async () => {
      const services = await getSharedServices()

      return {
        ...services,
      }
    },
  })

  logger.info("event server listening on %s", config.public.eventsPort)

  wss.on("error", error => {
    logger.error({ error }, "event server error")
  })

  nitro.hooks.hookOnce("close", async () => {
    handler.broadcastReconnectNotification()
    wss.close()
  })
})

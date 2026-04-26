import { appRouter } from "../router"
import { getSharedServices } from "@highstate/backend"
import { createBunServeHandler } from "trpc-bun-adapter"

export default defineNitroPlugin(async nitro => {
  const config = useRuntimeConfig()
  const { logger } = await getSharedServices()

  const handler = createBunServeHandler({
    endpoint: "/",
    router: appRouter,
    createContext: async () => {
      const services = await getSharedServices()

      return {
        ...services,
      }
    },
  })

  const server = Bun.serve({
    ...handler,
    port: config.public.eventsPort,
  })

  logger.info("event server listening on %s", config.public.eventsPort)

  nitro.hooks.hookOnce("close", async () => {
    // stop the dedicated events server when Nitro is shutting down
    server.stop(true)
  })
})

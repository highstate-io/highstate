import { getSharedServices } from "@highstate/backend"
import { createBunServeHandler } from "trpc-bun-adapter"
import { appRouter } from "../router"
import { isHostedAuth } from "../utils/auth-config"
import { sessionTokenFromHeaders } from "../utils/hosted-session"

export default defineNitroPlugin(async nitro => {
  const config = useRuntimeConfig()
  const { logger } = await getSharedServices()

  const handler = createBunServeHandler({
    endpoint: "/",
    router: appRouter,
    createContext: async ({ req }: { req: Request }) => {
      const services = await getSharedServices()

      return {
        ...services,
        designerSessionToken: isHostedAuth() ? sessionTokenFromHeaders(req.headers) : undefined,
      }
    },
    onError: ({ error }: { error: unknown }) => {
      logger.error({ error }, "trpc event request failed")
    },
  })

  const server = Bun.serve({
    ...handler,
    hostname: "127.0.0.1",
    port: config.public.eventsPort,
  })

  logger.info("event server listening on %s", config.public.eventsPort)

  nitro.hooks.hookOnce("close", async () => {
    // stop the dedicated events server when Nitro is shutting down
    server.stop(true)
  })
})

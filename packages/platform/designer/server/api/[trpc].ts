import { getSharedServices } from "@highstate/backend"
import { createTRPCNuxtHandler } from "trpc-nuxt/server"
import { appRouter } from "../router"
import { sessionCookie, sessionTokenFromHeaders } from "../utils/hosted-session"

export default createTRPCNuxtHandler({
  endpoint: "/api",
  router: appRouter,
  createContext: async event => {
    const services = await getSharedServices()

    return {
      ...services,
      designerSessionToken:
        "node" in event
          ? getCookie(event, sessionCookie)
          : sessionTokenFromHeaders(event.req.headers),
    }
  },
  onError: ({ error }) => {
    console.error("Server Error", error)
  },
})

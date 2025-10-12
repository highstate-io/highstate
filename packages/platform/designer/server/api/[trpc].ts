import { createTRPCNuxtHandler } from "trpc-nuxt/server"
import { appRouter } from "../router"
import { getSharedServices } from "@highstate/backend"

export default createTRPCNuxtHandler({
  endpoint: "/api",
  router: appRouter,
  createContext: async () => {
    const services = await getSharedServices()

    return {
      ...services,
    }
  },
  onError: error => {
    console.error("Server Error", error)
  },
})

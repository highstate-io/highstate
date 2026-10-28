import { getSharedServices } from "@highstate/backend"
import { createTRPCNuxtHandler } from "trpc-nuxt/server"
import { appRouter } from "../router"

export default createTRPCNuxtHandler({
  endpoint: "/api",
  router: appRouter,
  createContext: async () => {
    const services = await getSharedServices()

    return { ...services }
  },
  onError: ({ error }) => {
    console.error("Server Error", error)
  },
})

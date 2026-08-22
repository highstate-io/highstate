import { splitLink, httpBatchStreamLink, wsLink, createWSClient } from "@trpc/client"
import { createTRPCNuxtClient } from "trpc-nuxt/client"
import type { AppRouter } from "~~/server/router"
import superjson from "superjson"

export default defineNuxtPlugin(() => {
  const protocol = location.protocol === "https:" ? "wss" : "ws"
  const config = useRuntimeConfig()

  const wsClient = createWSClient({
    url: import.meta.dev
      ? `${protocol}://${location.hostname}:${config.public.eventsPort}`
      : `${protocol}://${location.host}/api/events`,
  })

  const client = createTRPCNuxtClient<AppRouter>({
    links: [
      splitLink({
        condition: op => op.type === "subscription",
        true: wsLink({
          transformer: superjson,
          client: wsClient,
        }),
        false: httpBatchStreamLink({
          transformer: superjson,
          url: `/api`,
        }),
      }),
    ],
  })

  return {
    provide: {
      client,
    },
  }
})

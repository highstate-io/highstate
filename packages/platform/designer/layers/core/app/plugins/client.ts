import type { AppRouter } from "~~/server/router"
import { createWSClient, httpBatchStreamLink, splitLink, wsLink } from "@trpc/client"
import superjson from "superjson"
import { createTRPCNuxtClient } from "trpc-nuxt/client"

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

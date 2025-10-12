import type { Services } from "@highstate/backend"
import { initTRPC } from "@trpc/server"
import { userInfo } from "node:os"
import superjson from "superjson"

export type Context = Services

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  sse: {
    maxDurationMs: 3600_000,

    ping: {
      enabled: true,
      intervalMs: 2_000,
    },

    client: {
      reconnectAfterInactivityMs: 5_000,
    },
  },
})

export const publicProcedure = t.procedure

export const authenticatedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  // for now, only the local single user is supported
  const info = userInfo()

  return next({
    ctx: {
      ...ctx,
      userId: info.username,
    },
  })
})

export const router = t.router
export const middleware = t.middleware

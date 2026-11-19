import type { BackendPermission, ProjectPermission } from "@highstate/backend/shared"
import type { AppRouter } from "~~/server/router"
import { createWSClient, httpBatchStreamLink, splitLink, wsLink } from "@trpc/client"
import { observable } from "@trpc/server/observable"
import superjson from "superjson"
import { createTRPCNuxtClient } from "trpc-nuxt/client"
import { accessError, createAccessController } from "../utils/access-control"

export default defineNuxtPlugin({
  name: "client",
  setup(nuxt) {
    const protocol = location.protocol === "https:" ? "wss" : "ws"
    const config = useRuntimeConfig()

    const wsClient = createWSClient({
      url: import.meta.dev
        ? `${protocol}://${location.hostname}:${config.public.eventsPort}`
        : `${protocol}://${location.host}/api/events`,
    })

    const access = createAccessController(async checks => {
      const groups = Map.groupBy(checks, item => item.projectId ?? "")

      const results = await Promise.all(
        [...groups].map(async ([projectId, items]) => {
          try {
            const results: { key: string; allowed: boolean }[] = []

            for (let offset = 0; offset < items.length; offset += 200) {
              const batch = items.slice(offset, offset + 200)

              if (projectId) {
                results.push(
                  ...(await client.access.project.query({
                    projectId,
                    checks: batch.map(item => ({
                      ...item,
                      permission: item.permission as ProjectPermission,
                    })),
                  })),
                )
              } else {
                results.push(
                  ...(await client.access.backend.query({
                    checks: batch.map(item => ({
                      ...item,
                      permission: item.permission as BackendPermission,
                    })),
                  })),
                )
              }
            }

            return results
          } catch (error) {
            if (accessError(error)?.unauthorized) {
              throw error
            }

            return items.map(item => ({
              key: item.key,
              allowed: false,
              reason:
                accessError(error)?.message ??
                "Access could not be checked. It will recover automatically when the project and connection are available.",
            }))
          }
        }),
      )

      return results.flat()
    })

    const client = createTRPCNuxtClient<AppRouter>({
      links: [
        () =>
          ({ op, next }) =>
            observable(observer =>
              next(op).subscribe({
                next: result => observer.next(result),
                complete: () => observer.complete(),
                error: error => {
                  if (!op.path.startsWith("access.")) {
                    access.reject(error, op.path, op.input, op.type !== "query")
                  }

                  observer.error(error)
                },
              }),
            ),
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

    nuxt.hook("vue:error", error => {
      access.reject(error, "interface")
    })

    window.addEventListener("unhandledrejection", event => {
      if (access.reject(event.reason, access.rejection.value?.path ?? "interface")) {
        event.preventDefault()
      }
    })

    const stopWatching = watch(access.checks, (checks, _, onCleanup) => {
      const subscriptions: { unsubscribe: () => void }[] = []
      const timers: ReturnType<typeof setTimeout>[] = []
      let stopped = false

      for (let offset = 0; offset < checks.length; offset += 200) {
        const batch = checks.slice(offset, offset + 200)

        const connect = () => {
          if (stopped || !access.authenticated.value) {
            return
          }

          const subscription = client.access.watch.subscribe(
            {
              checks: batch.map(item =>
                item.projectId
                  ? {
                      ...item,
                      realm: "project" as const,
                      projectId: item.projectId,
                      permission: item.permission as ProjectPermission,
                    }
                  : {
                      ...item,
                      realm: "backend" as const,
                      permission: item.permission as BackendPermission,
                    },
              ),
            },
            {
              onData: results => access.apply(results),
              onError: error => {
                access.reject(error, "access synchronization")

                access.apply(
                  batch.map(item => ({
                    key: item.key,
                    allowed: false,
                    reason:
                      accessError(error)?.message ??
                      "Access synchronization is disconnected. Reconnecting automatically…",
                  })),
                )

                timers.push(setTimeout(connect, 1000))
              },
            },
          )

          subscriptions.push(subscription)
        }

        connect()
      }

      onCleanup(() => {
        stopped = true

        subscriptions.forEach(item => {
          item.unsubscribe()
        })

        timers.forEach(clearTimeout)
      })
    })

    if (import.meta.hot) {
      import.meta.hot.dispose(stopWatching)
    }

    return {
      provide: {
        client,
        access,
      },
    }
  },
})

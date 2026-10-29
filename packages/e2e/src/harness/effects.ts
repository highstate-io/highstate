export type ResourceEffect = {
  method: string
  key: string
  marker: string | null
  state?: Record<string, unknown>
}

/**
 * Provides observable local infrastructure for the real Pulumi dynamic provider.
 */
export function startEffects(host: string) {
  const resources = new Map<string, Record<string, unknown>>()
  const events: ResourceEffect[] = []
  const gates = new Map<string, { promise: Promise<void>; release(): void }>()

  const server = Bun.serve({
    hostname: "0.0.0.0",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (!path.startsWith("/resources/")) {
        return new Response("Not found", { status: 404 })
      }

      const key = decodeURIComponent(path.slice("/resources/".length))

      const state =
        request.method === "GET" ? undefined : ((await request.json()) as Record<string, unknown>)

      events.push({
        method: request.method,
        key,
        marker: request.headers.get("x-highstate-marker"),
        state,
      })

      await gates.get(key)?.promise

      if (request.method === "GET") {
        const resource = resources.get(key)
        return resource ? Response.json(resource) : new Response("Not found", { status: 404 })
      }

      if (request.method === "DELETE") {
        resources.delete(key)
      } else if (state) {
        resources.set(key, state)
      }

      return Response.json({ ok: true })
    },
  })

  return {
    url: `http://${host}:${server.port}`,
    resources,
    events,
    hold(key: string) {
      let release!: () => void

      const promise = new Promise<void>(resolve => {
        release = resolve
      })

      gates.set(key, { promise, release })
    },
    release(key: string) {
      gates.get(key)?.release()
      gates.delete(key)
    },
    async stop() {
      for (const gate of gates.values()) {
        gate.release()
      }

      await server.stop(true)
    },
  }
}
export type Effects = ReturnType<typeof startEffects>

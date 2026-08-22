import { describe, expect, test } from "vitest"
import { PanelDataServer, PanelTargetRegistry } from "./panel"

describe("PanelTargetRegistry", () => {
  test("replaces targets for a state", () => {
    const registry = new PanelTargetRegistry()
    registry.apply("state", registry.prepare([{ name: "old", target: "http://127.0.0.1:8080" }]))
    registry.apply("state", registry.prepare([{ name: "next", target: "https://service:8443" }]))

    expect(registry.get("state", "old")).toBeUndefined()
    expect(registry.get("state", "next")?.target.href).toBe("https://service:8443/")
  })

  test("validates every target before registration state changes", () => {
    const registry = new PanelTargetRegistry()
    registry.apply("state", registry.prepare([{ name: "panel", target: "http://127.0.0.1:8080" }]))

    expect(() => registry.prepare([{ name: "invalid", target: "file:///secret" }])).toThrow(
      "Panel target protocol must be HTTP or HTTPS",
    )
    expect(registry.get("state", "panel")?.target.host).toBe("127.0.0.1:8080")
  })

  test("preserves the HTTP request interceptor", () => {
    const registry = new PanelTargetRegistry()
    const interceptHttpRequest = () => new Response("intercepted")
    registry.apply(
      "state",
      registry.prepare([{ interceptHttpRequest, name: "panel", target: "http://127.0.0.1:8080" }]),
    )

    expect(registry.get("state", "panel")?.interceptHttpRequest).toBe(interceptHttpRequest)
  })
})

test("proxies decoded bodies without stale representation headers", async () => {
  let acceptEncoding: string | null = null
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      acceptEncoding = request.headers.get("accept-encoding")

      return new Response("asset", {
        headers: {
          "content-encoding": "identity",
          "content-length": "5",
          "content-type": "text/javascript",
        },
      })
    },
  })
  const registry = new PanelTargetRegistry()
  registry.apply(
    "state",
    registry.prepare([{ name: "panel", target: `http://127.0.0.1:${upstream.port}` }]),
  )
  const proxy = new PanelDataServer(registry, 0)
  proxy.start()

  try {
    const response = await fetch(`http://127.0.0.1:${proxy.port}/asset.js`, {
      headers: {
        "accept-encoding": "br",
        "x-highstate-panel-name": "panel",
        "x-highstate-state-id": "state",
      },
    })

    expect(await response.text()).toBe("asset")
    expect(acceptEncoding).toBe("identity")
    expect(response.headers.has("content-encoding")).toBe(false)
    expect(response.headers.get("content-length")).toBe("5")
  } finally {
    proxy.stop()
    await upstream.stop(true)
  }
})

test("proxies WebSocket subprotocol negotiation", async () => {
  let offeredProtocols: string | null = null
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      offeredProtocols = request.headers.get("sec-websocket-protocol")
      if (server.upgrade(request, { headers: { "sec-websocket-protocol": "v4.channel.k8s.io" } })) {
        return
      }

      return new Response("WebSocket upgrade failed", { status: 500 })
    },
    websocket: {
      message(socket, message) {
        socket.send(message)
      },
    },
  })
  const registry = new PanelTargetRegistry()
  registry.apply(
    "state",
    registry.prepare([{ name: "panel", target: `http://127.0.0.1:${upstream.port}` }]),
  )
  const proxy = new PanelDataServer(registry, 0)
  proxy.start()

  const WebSocketClient = WebSocket as unknown as {
    new (address: string | URL, options: Bun.WebSocketOptions): WebSocket
  }
  const socket = new WebSocketClient(`ws://127.0.0.1:${proxy.port}/exec`, {
    headers: {
      "x-highstate-panel-name": "panel",
      "x-highstate-state-id": "state",
    },
    protocols: ["base64.binary.k8s.io", "v4.channel.k8s.io"],
  })

  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true })
      socket.addEventListener("error", reject, { once: true })
    })
    const message = new Promise<string>(resolve => {
      socket.addEventListener("message", event => resolve(String(event.data)), { once: true })
    })
    socket.send("terminal data")

    expect(await message).toBe("terminal data")
    expect(socket.protocol).toBe("v4.channel.k8s.io")
    expect(offeredProtocols).toBe("base64.binary.k8s.io, v4.channel.k8s.io")
  } finally {
    socket.close()
    proxy.stop()
    await upstream.stop(true)
  }
})

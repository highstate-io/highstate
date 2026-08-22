const stateHeader = "x-highstate-state-id"
const panelHeader = "x-highstate-panel-name"

export type PanelTarget = {
  interceptHttpRequest?: PanelHttpRequestInterceptor
  name: string
  target: URL
}

export type PanelHttpRequestInterceptor = (
  request: Request,
  forward: (request: Request) => Promise<Response>,
) => Promise<Response> | Response

type WebSocketData = {
  upstream: WebSocket
}

export class PanelTargetRegistry {
  private readonly targetsByState = new Map<string, Map<string, PanelTarget>>()

  prepare(
    panels: Array<{
      interceptHttpRequest?: PanelHttpRequestInterceptor
      name: string
      target: string
    }>,
  ): PanelTarget[] {
    return panels.map(panel => {
      const target = new URL(panel.target)
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw new Error(`Panel target protocol must be HTTP or HTTPS`)
      }

      return { interceptHttpRequest: panel.interceptHttpRequest, name: panel.name, target }
    })
  }

  apply(stateId: string, panels: PanelTarget[]): void {
    this.targetsByState.set(stateId, new Map(panels.map(panel => [panel.name, panel])))
  }

  get(stateId: string, panelName: string): PanelTarget | undefined {
    return this.targetsByState.get(stateId)?.get(panelName)
  }

  async waitUntilReady(panels: PanelTarget[]): Promise<void> {
    await Promise.all(panels.map(async panel => await waitUntilReady(panel.target)))
  }
}

export class PanelDataServer {
  private server?: Bun.Server<WebSocketData>

  constructor(
    private readonly targets: PanelTargetRegistry,
    private readonly listenPort = 7284,
  ) {}

  get port(): number | undefined {
    return this.server?.port
  }

  start(): void {
    if (this.server) {
      return
    }

    this.server = Bun.serve<WebSocketData>({
      hostname: "0.0.0.0",
      idleTimeout: 0,
      port: this.listenPort,
      fetch: async (request, server) => {
        const target = this.resolveTarget(request)
        if (!target) {
          return new Response("Panel not found", { status: 404 })
        }

        if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
          return await this.upgradeWebSocket(request, server, target)
        }

        const forward = async (forwardedRequest: Request) =>
          await proxyRequest(forwardedRequest, target.target)

        return target.interceptHttpRequest
          ? await target.interceptHttpRequest(request, forward)
          : await forward(request)
      },
      websocket: {
        open(socket) {
          socket.data.upstream.addEventListener("message", event => socket.send(event.data))
          socket.data.upstream.addEventListener("close", event =>
            socket.close(event.code, event.reason),
          )
          socket.data.upstream.addEventListener("error", () =>
            socket.close(1011, "Panel WebSocket connection failed"),
          )
        },
        message(socket, message) {
          socket.data.upstream.send(message)
        },
        close(socket, code, reason) {
          socket.data.upstream.close(code, reason)
        },
      },
    })
  }

  stop(): void {
    this.server?.stop(true)
    this.server = undefined
  }

  private resolveTarget(request: Request): PanelTarget | undefined {
    const stateId = request.headers.get(stateHeader)
    const panelName = request.headers.get(panelHeader)
    if (!stateId || !panelName) {
      return undefined
    }

    return this.targets.get(stateId, panelName)
  }

  private async upgradeWebSocket(
    request: Request,
    server: Bun.Server<WebSocketData>,
    target: PanelTarget,
  ): Promise<Response | undefined> {
    const url = createTargetUrl(target.target, request.url)
    url.protocol = target.target.protocol === "https:" ? "wss:" : "ws:"
    const protocols = request.headers
      .get("sec-websocket-protocol")
      ?.split(",")
      .map(value => value.trim())
      .filter(Boolean)
    const headers = Object.fromEntries(
      Array.from(request.headers)
        .filter(([name]) => !webSocketHeadersToRemove.has(name.toLowerCase()))
        .map(([name, value]) => [name, value]),
    )
    const WebSocketClient = WebSocket as unknown as {
      new (address: string | URL, options: Bun.WebSocketOptions): WebSocket
    }
    const upstream = new WebSocketClient(url, {
      headers,
      ...(protocols?.length ? { protocols } : {}),
    })
    const connected = await new Promise<boolean>(resolve => {
      upstream.addEventListener("open", () => resolve(true), { once: true })
      upstream.addEventListener("error", () => resolve(false), { once: true })
    })
    if (!connected) {
      return new Response("Panel WebSocket connection failed", { status: 502 })
    }
    const upgradeHeaders = new Headers()
    if (upstream.protocol) {
      upgradeHeaders.set("sec-websocket-protocol", upstream.protocol)
    }
    if (!server.upgrade(request, { data: { upstream }, headers: upgradeHeaders })) {
      upstream.close()
      return new Response("WebSocket upgrade failed", { status: 500 })
    }

    return undefined
  }
}

const webSocketHeadersToRemove = new Set([
  stateHeader,
  panelHeader,
  "connection",
  "host",
  "sec-websocket-extensions",
  "sec-websocket-key",
  "sec-websocket-protocol",
  "sec-websocket-version",
  "upgrade",
])

async function proxyRequest(request: Request, target: URL): Promise<Response> {
  const headers = new Headers(request.headers)
  headers.delete(stateHeader)
  headers.delete(panelHeader)
  headers.set("accept-encoding", "identity")
  headers.delete("host")

  const response = await fetch(createTargetUrl(target, request.url), {
    body: request.body,
    headers,
    method: request.method,
    redirect: "manual",
  })
  const responseHeaders = new Headers(response.headers)
  responseHeaders.delete("content-encoding")
  responseHeaders.delete("content-length")

  const location = responseHeaders.get("location")
  if (location) {
    responseHeaders.set("location", rewriteLocation(location, target, new URL(request.url)))
  }

  return new Response(response.body, {
    headers: responseHeaders,
    status: response.status,
    statusText: response.statusText,
  })
}

function createTargetUrl(target: URL, requestUrl: string): URL {
  const request = new URL(requestUrl)
  const url = new URL(target)
  url.pathname = request.pathname
  url.search = request.search

  return url
}

function rewriteLocation(value: string, target: URL, requestUrl: URL): string {
  let location: URL
  try {
    location = new URL(value, target)
  } catch {
    return value
  }
  if (location.origin !== target.origin) {
    return value
  }

  return `${requestUrl.origin}${location.pathname}${location.search}${location.hash}`
}

async function waitUntilReady(target: URL): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(target)
      if (response.ok) {
        return
      }
    } catch {
      // target is still starting
    }

    await Bun.sleep(250)
  }

  throw new Error(`Panel target "${target.origin}" did not become ready within 30 seconds`)
}

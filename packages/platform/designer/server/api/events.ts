type EventsBridgeState = {
  pendingMessages: string[]
  upstream: WebSocket
}

const stateByPeerId = new Map<string, EventsBridgeState>()

export default defineWebSocketHandler({
  upgrade: request => {
    const origin = request.headers.get("origin")
    if (!origin || !isDesignerOrigin(origin, request.url)) {
      return new Response("Forbidden", { status: 403 })
    }
  },

  open: peer => {
    const config = useRuntimeConfig()
    const upstream = new WebSocket(`ws://127.0.0.1:${config.public.eventsPort}`)
    const state: EventsBridgeState = {
      pendingMessages: [],
      upstream,
    }

    stateByPeerId.set(peer.id, state)

    upstream.addEventListener("open", () => {
      for (const message of state.pendingMessages) {
        upstream.send(message)
      }

      state.pendingMessages.length = 0
    })

    upstream.addEventListener("message", event => {
      peer.send(event.data)
    })

    upstream.addEventListener("close", event => {
      stateByPeerId.delete(peer.id)
      peer.close(event.code, event.reason)
    })

    upstream.addEventListener("error", () => {
      peer.close(1011, "Event server connection failed")
    })
  },

  message: (peer, message) => {
    const state = stateByPeerId.get(peer.id)
    if (!state) {
      return
    }

    const data = message.text()

    if (state.upstream.readyState === WebSocket.OPEN) {
      state.upstream.send(data)
      return
    }

    state.pendingMessages.push(data)
  },

  close: peer => {
    const state = stateByPeerId.get(peer.id)
    if (!state) {
      return
    }

    state.upstream.close()
    stateByPeerId.delete(peer.id)
  },
})

function isDesignerOrigin(origin: string, requestUrl: string): boolean {
  try {
    const originUrl = new URL(origin)
    const targetUrl = new URL(requestUrl)
    return (
      originUrl.hostname === "highstate.localhost" &&
      originUrl.protocol === targetUrl.protocol.replace("ws", "http") &&
      originUrl.port === targetUrl.port
    )
  } catch {
    return false
  }
}

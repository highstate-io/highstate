import { getSharedServices } from "@highstate/backend"
import WebSocket from "ws"
import { isHostedAuth } from "../utils/auth-config"
import { isDesignerOrigin } from "../utils/designer-host"
import {
  authenticateHostedSession,
  monitorHostedSession,
  requireHostedOrigin,
  sessionTokenFromHeaders,
} from "../utils/hosted-session"

type EventsBridgeState = {
  pendingMessages: string[]
  upstream: WebSocket
  timer?: ReturnType<typeof setInterval>
}

const stateByPeerId = new Map<string, EventsBridgeState>()

export default defineWebSocketHandler({
  upgrade: async request => {
    if (isHostedAuth()) {
      try {
        requireHostedOrigin(request.headers)

        await authenticateHostedSession(
          await getSharedServices(),
          sessionTokenFromHeaders(request.headers),
        )
      } catch {
        return new Response("Unauthorized", { status: 401 })
      }

      return
    }

    const origin = request.headers.get("origin")
    const redirectDisabled = process.env.HIGHSTATE_DESIGNER_NO_REDIRECT !== undefined
    if (!origin || !isDesignerOrigin(origin, request.url, redirectDisabled)) {
      return new Response("Forbidden", { status: 403 })
    }
  },

  open: async peer => {
    const config = useRuntimeConfig()

    const upstream = new WebSocket(`ws://127.0.0.1:${config.public.eventsPort}`, {
      headers: isHostedAuth() ? { cookie: peer.request?.headers.get("cookie") ?? "" } : {},
    })

    const state: EventsBridgeState = {
      pendingMessages: [],
      upstream,
    }

    stateByPeerId.set(peer.id, state)

    if (isHostedAuth()) {
      state.timer = monitorHostedSession(
        await getSharedServices(),
        peer.request ? sessionTokenFromHeaders(peer.request.headers) : undefined,
        () => {
          upstream.close()
          peer.close(1008, "Session expired or revoked")
        },
      )
    }

    upstream.addEventListener("open", () => {
      for (const message of state.pendingMessages) {
        upstream.send(message)
      }

      state.pendingMessages.length = 0
    })

    upstream.addEventListener("message", event => {
      peer.send(String(event.data))
    })

    upstream.addEventListener("close", event => {
      clearInterval(state.timer)
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
    clearInterval(state.timer)
    stateByPeerId.delete(peer.id)
  },
})

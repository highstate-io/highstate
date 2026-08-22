import { getSharedServices } from "@highstate/backend"
import WebSocket from "ws"
import { isPanelSessionSource } from "../utils/panel-response"
import { getActivePanelSession, getPanelIdFromHost, getPanelSession } from "../utils/panel-session"

type PanelWebSocketState = {
  upstream: WebSocket
}

type UpgradeRequest = {
  headers: Headers
  url: string
}

const stateByPeerId = new Map<string, PanelWebSocketState>()

export default defineWebSocketHandler({
  upgrade: request => {
    const panelId = getPanelIdFromHost(request.headers.get("host") ?? undefined)
    const sessionId = getCookieValue(request.headers.get("cookie"), "highstate-panel-session")
    const session = panelId ? getRequestPanelSession(request, panelId, sessionId) : undefined
    if (!panelId || !session) {
      return new Response("Panel session required", { status: 401 })
    }

    const protocol = getFirstWebSocketProtocol(request.headers)
    return protocol ? { headers: { "sec-websocket-protocol": protocol } } : undefined
  },

  open: async peer => {
    const request = peer.request
    if (!request) {
      peer.close(1008, "Upgrade request unavailable")
      return
    }

    const panelId = getPanelIdFromHost(request.headers.get("host") ?? undefined)
    const sessionId = getCookieValue(request.headers.get("cookie"), "highstate-panel-session")
    const session = panelId ? getRequestPanelSession(request, panelId, sessionId) : undefined
    if (!panelId || !session) {
      peer.close(1008, "Panel session required")
      return
    }

    const services = await getSharedServices()
    const database = await services.database.forProject(session.projectId)
    const panel = await database.panel.findUnique({
      where: { id: panelId },
      select: { workerVersionId: true },
    })
    if (!panel) {
      peer.close(1008, "Panel not found")
      return
    }

    try {
      const endpoint = services.panelEndpointManager.getPanelEndpoint(
        session.projectId,
        panel.workerVersionId,
        panelId,
        session.workerInstanceId,
      )
      if (!endpoint) {
        peer.close(1011, "Panel worker instance is unavailable")
        return
      }
      const url = new URL(request.url)
      const protocol = getFirstWebSocketProtocol(request.headers)
      const upstream = new WebSocket(
        `ws://${endpoint.authority}${url.pathname}${url.search}`,
        protocol ? [protocol] : [],
        {
          headers: {
            ...getWebSocketHeaders(request.headers),
            "x-highstate-panel-name": endpoint.panelName,
            "x-highstate-state-id": endpoint.stateId,
          },
        },
      )
      stateByPeerId.set(peer.id, { upstream })

      upstream.binaryType = "arraybuffer"
      upstream.on("message", (data, binary) => {
        peer.send(binary ? new Uint8Array(data as ArrayBuffer) : data.toString())
      })
      upstream.once("close", (code, reason) => {
        stateByPeerId.delete(peer.id)
        peer.close(code, reason.toString())
      })
      upstream.once("error", () => {
        stateByPeerId.delete(peer.id)
        peer.close(1011, "Panel WebSocket connection failed")
      })
    } catch {
      peer.close(1011, "Panel WebSocket connection failed")
    }
  },

  message: (peer, message) => {
    const state = stateByPeerId.get(peer.id)
    if (!state) {
      return
    }

    const binary = typeof message.rawData !== "string"
    state.upstream.send(binary ? message.uint8Array() : message.text(), { binary })
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

function getCookieValue(header: string | null, name: string): string | undefined {
  return header
    ?.split(";")
    .map(value => value.trim().split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=")
}

function getRequestPanelSession(
  request: UpgradeRequest,
  panelId: string,
  sessionId: string | undefined,
) {
  const session = sessionId ? getPanelSession(sessionId, panelId) : undefined
  if (session) {
    return session
  }

  return isPanelSessionSource(
    request.headers.get("origin") ?? undefined,
    panelId,
    new URL(request.url),
  )
    ? getActivePanelSession(panelId)
    : undefined
}

function getFirstWebSocketProtocol(headers: Headers): string | undefined {
  return headers
    .get("sec-websocket-protocol")
    ?.split(",")
    .map(value => value.trim())
    .find(Boolean)
}

function getWebSocketHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    Array.from(headers)
      .filter(([name]) => !requestHeadersToRemove.has(name.toLowerCase()))
      .map(([name, value]) => [name, value]),
  )
}

const requestHeadersToRemove = new Set([
  "connection",
  "cookie",
  "host",
  "sec-websocket-extensions",
  "sec-websocket-key",
  "sec-websocket-protocol",
  "sec-websocket-version",
  "upgrade",
])

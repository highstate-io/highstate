import { PassThrough } from "node:stream"
import { getSharedServices, requireProjectPermission } from "@highstate/backend"
import { isHostedAuth } from "../../../../utils/auth-config"
import {
  authenticateHostedSession,
  monitorHostedSession,
  requireHostedOrigin,
  sessionTokenFromHeaders,
} from "../../../../utils/hosted-session"
import { authenticateProjectHeaders } from "../../../../utils/request-authentication"

type TerminalBridgeState = {
  abortController: AbortController
  stdin: PassThrough
  timer?: ReturnType<typeof setInterval>
}

const terminalBridgeStateByPeerId = new Map<string, TerminalBridgeState>()

export default defineWebSocketHandler({
  upgrade: async request => {
    if (!isHostedAuth()) {
      return
    }

    try {
      requireHostedOrigin(request.headers)

      await authenticateHostedSession(
        await getSharedServices(),
        sessionTokenFromHeaders(request.headers),
      )
    } catch {
      return new Response("Unauthorized", { status: 401 })
    }
  },
  open: async peer => {
    if (!peer.request) {
      throw new Error("Upgrade request not available")
    }

    const services = await getSharedServices()
    const abortController = new AbortController()

    const stdin = new PassThrough()

    const stdout = createOutputStream(
      data => peer.send(data),
      () => peer.websocket.close?.(),
    )

    const parsedUrl = new URL(peer.request.url!)

    const pathRegex =
      /^\/api\/projects\/(?<projectId>[^/]+)\/terminal-sessions\/(?<sessionId>[^/]+)\/?$/

    const match = parsedUrl.pathname.match(pathRegex)
    if (!match) {
      throw new Error("Invalid path")
    }

    const { projectId, sessionId } = match.groups as {
      projectId: string
      sessionId: string
    }

    // validate projectId and sessionId
    if (!projectId || !sessionId) {
      throw new Error("Missing projectId or sessionId")
    }

    // verify that the session belongs to the specified project
    const database = await services.database.forProject(projectId)

    const session = await database.terminalSession.findUnique({
      where: { id: sessionId },
      include: { terminal: true },
    })

    if (!session) {
      throw new Error("Terminal session not found")
    }

    const context = await authenticateProjectHeaders(services, peer.request.headers, projectId)
    requireProjectPermission(context, "terminal.connect", { resourceId: session.terminalId })

    const screenSizeText = parsedUrl.searchParams.get("screenSize")
    if (!screenSizeText) {
      throw new Error("Missing screenSize in query")
    }

    const [cols, rows] = screenSizeText.split("x").map(Number)

    if (Number.isNaN(cols) || Number.isNaN(rows)) {
      throw new Error("Invalid screenSize")
    }

    terminalBridgeStateByPeerId.set(peer.id, {
      abortController,
      stdin,
      timer: isHostedAuth()
        ? monitorHostedSession(
            services,
            sessionTokenFromHeaders(peer.request.headers),
            () => {
              abortController.abort()
              stdin.end()
              peer.close(1008, "Session expired or revoked")
            },
            async () => {
              const current = await authenticateProjectHeaders(
                services,
                peer.request!.headers,
                projectId,
              )

              requireProjectPermission(current, "terminal.connect", {
                resourceId: session.terminalId,
              })
            },
          )
        : undefined,
    })

    services.terminalManager.attach(
      sessionId,
      stdin,
      stdout,
      { cols, rows },
      abortController.signal,
    )
  },

  message: (peer, message) => {
    const state = terminalBridgeStateByPeerId.get(peer.id)
    if (!state) {
      return
    }

    state.stdin.write(message.data)
  },

  close: peer => {
    const state = terminalBridgeStateByPeerId.get(peer.id)
    if (!state) {
      return
    }

    state.abortController.abort()
    clearInterval(state.timer)
    state.stdin.end()
    terminalBridgeStateByPeerId.delete(peer.id)
  },
})

function createOutputStream(send: (data: string) => void, close: () => void) {
  const stream = new PassThrough()

  stream.on("data", data => {
    send(String(data).replace(/\n/g, "\r\n"))
  })

  stream.on("end", close)

  return stream
}

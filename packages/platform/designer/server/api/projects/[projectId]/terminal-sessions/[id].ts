import { PassThrough } from "node:stream"
import { getSharedServices } from "@highstate/backend"

type TerminalBridgeState = {
  abortController: AbortController
  stdin: PassThrough
  sessionId: string
}

const terminalBridgeStateByPeerId = new Map<string, TerminalBridgeState>()

export default defineWebSocketHandler({
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

    const screenSizeText = parsedUrl.searchParams.get("screenSize")
    if (!screenSizeText) {
      throw new Error("Missing screenSize in query")
    }

    const [cols, rows] = screenSizeText.split("x").map(Number)
    if (![cols, rows].every(value => Number.isSafeInteger(value) && value > 0 && value <= 65535)) {
      throw new Error("Invalid screenSize")
    }

    terminalBridgeStateByPeerId.set(peer.id, {
      abortController,
      stdin,
      sessionId,
    })

    services.terminalManager.attach(
      sessionId,
      stdin,
      stdout,
      { cols, rows },
      abortController.signal,
    )
  },

  message: async (peer, message) => {
    const state = terminalBridgeStateByPeerId.get(peer.id)
    if (!state) {
      return
    }

    if (typeof message.data === "string") {
      const control = JSON.parse(message.data) as { type: string; cols?: number; rows?: number }
      if (control.type === "resize" && control.cols !== undefined && control.rows !== undefined) {
        const services = await getSharedServices()
        await services.terminalManager.resize(state.sessionId, {
          cols: control.cols,
          rows: control.rows,
        })
      }
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
    state.stdin.end()
    terminalBridgeStateByPeerId.delete(peer.id)
  },
})

function createOutputStream(send: (data: Uint8Array) => void, close: () => void) {
  const stream = new PassThrough()

  stream.on("data", data => {
    send(data)
  })

  stream.on("end", close)

  return stream
}

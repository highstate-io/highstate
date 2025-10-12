import { getSharedServices } from "@highstate/backend"
import { PassThrough } from "node:stream"

export default defineWebSocketHandler({
  open: async peer => {
    if (!peer.request) {
      throw new Error("Upgrade request not available")
    }

    const services = await getSharedServices()
    const abortController = new AbortController()

    const stdin = createInputStream(peer.websocket as Partial<WebSocket>)
    const stdout = createOutputStream(peer.websocket as Partial<WebSocket>)

    peer.websocket.onclose = () => {
      abortController.abort()
      stdin.end()
    }

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
    if (isNaN(cols) || isNaN(rows)) {
      throw new Error("Invalid screenSize")
    }

    services.terminalManager.attach(
      sessionId,
      stdin,
      stdout,
      { cols, rows },
      abortController.signal,
    )
  },
})

function createInputStream(ws: Partial<WebSocket>) {
  const stream = new PassThrough()

  ws.onmessage = data => {
    return stream.write(data.data)
  }

  return stream
}

function createOutputStream(ws: Partial<WebSocket>) {
  const stream = new PassThrough()

  stream.on("data", data => {
    ws.send!(String(data).replace(/\n/g, "\r\n"))
  })

  stream.on("end", () => ws.close!())

  return stream
}

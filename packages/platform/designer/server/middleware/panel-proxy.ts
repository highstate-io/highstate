import { Readable } from "node:stream"
import { getSharedServices } from "@highstate/backend"
import {
  getPanelCorsOrigin,
  getPanelFrameContentSecurityPolicy,
  isPanelSessionSetCookie,
  isPanelSessionSource,
  removePanelSessionCookie,
  rewritePanelLocation,
  sanitizePanelResponseHeader,
} from "../utils/panel-response"
import {
  getActivePanelSession,
  getPanelIdFromHost,
  getPanelSession,
  isNestedPanelHost,
} from "../utils/panel-session"

export default defineEventHandler(async event => {
  const panelId = getPanelIdFromHost(getHeader(event, "host"))
  if (!panelId) {
    return
  }

  if (event.path.startsWith("/api/panels/launch")) {
    return
  }

  const corsOrigin = getPanelCorsOrigin(getHeader(event, "origin"), panelId, getRequestURL(event))
  if (corsOrigin) {
    setResponseHeader(event, "Access-Control-Allow-Origin", corsOrigin)
    setResponseHeader(event, "Access-Control-Allow-Credentials", "true")
    appendResponseHeader(event, "Vary", "Origin")
  }

  if (event.method === "OPTIONS" && corsOrigin) {
    setResponseHeader(
      event,
      "Access-Control-Allow-Methods",
      getHeader(event, "access-control-request-method") ?? "GET, HEAD, POST, PUT, PATCH, DELETE",
    )

    const requestedHeaders = getHeader(event, "access-control-request-headers")
    if (requestedHeaders) {
      setResponseHeader(event, "Access-Control-Allow-Headers", requestedHeaders)
    }

    setResponseStatus(event, 204)
    return ""
  }

  const sessionId = getCookie(event, "highstate-panel-session")
  let session = sessionId ? getPanelSession(sessionId, panelId) : undefined
  const sessionSource = getHeader(event, "origin") ?? getHeader(event, "referer")
  const hasSessionSource = isPanelSessionSource(sessionSource, panelId, getRequestURL(event))
  if (
    !session &&
    hasSessionSource &&
    (!isNestedPanelHost(getHeader(event, "host"), panelId) || corsOrigin)
  ) {
    session = getActivePanelSession(panelId)
  }

  if (!session) {
    return sendPanelError(event, 401, "Panel session required")
  }

  const services = await getSharedServices()
  const database = await services.database.forProject(session.projectId)

  const panel = await database.panel.findUnique({
    where: { id: panelId },
    select: { workerVersionId: true },
  })

  if (!panel) {
    return sendPanelError(event, 404, "Panel not found")
  }

  const upstream = services.panelEndpointManager.getPanelEndpoint(
    session.projectId,
    panel.workerVersionId,
    panelId,
    session.workerInstanceId,
  )

  if (!upstream) {
    return sendPanelError(event, 502, "Panel worker instance is unavailable")
  }

  const headers: Record<string, string | string[] | undefined> = {
    ...getHeaders(event),
  }

  for (const name of requestHeadersToRemove) {
    delete headers[name]
  }

  const upstreamCookie = removePanelSessionCookie(getHeader(event, "cookie"))
  if (upstreamCookie) {
    headers.cookie = upstreamCookie
  } else {
    delete headers.cookie
  }

  delete headers["x-highstate-panel-name"]
  delete headers["x-highstate-state-id"]
  const controller = new AbortController()
  const abort = () => controller.abort()
  event.node.req.once("aborted", abort)
  event.node.res.once("close", abort)

  try {
    const body = getRequestWebStream(event)

    const response = await services.panelEndpointManager.proxy(
      session.projectId,
      panel.workerVersionId,
      panelId,
      session.workerInstanceId,
      {
        method: event.method,
        path: event.path,
        headers: Object.entries(headers).flatMap(([name, values]) =>
          values === undefined
            ? []
            : (Array.isArray(values) ? values : [values]).map(value => ({ name, value })),
        ),
        body: (async function* () {
          if (!body) {
            return
          }

          const reader = body.getReader()

          try {
            for (;;) {
              const { done, value } = await reader.read()

              if (done) {
                break
              }

              for (let offset = 0; offset < value.byteLength; offset += 65536) {
                yield value.subarray(offset, offset + 65536)
              }
            }
          } finally {
            await reader.cancel()
            reader.releaseLock()
          }
        })(),
      },
      controller.signal,
    )

    return await sendProxyResponse(event, response)
  } catch (error) {
    console.error("Panel proxy request failed:", error)
    return sendPanelError(event, 502, "Panel upstream request failed")
  } finally {
    event.node.req.off("aborted", abort)
    event.node.res.off("close", abort)
  }
})

async function sendProxyResponse(
  event: Parameters<typeof getHeaders>[0],
  response: {
    status: number
    headers: { name: string; value: string }[]
    body: AsyncIterable<Uint8Array>
  },
): Promise<unknown> {
  setResponseStatus(event, response.status)

  for (const { name, value } of response.headers) {
    const sanitized = sanitizePanelResponseHeader({ name, value })
    if (sanitized && !hopByHopHeaders.has(sanitized.name.toLowerCase())) {
      if (
        sanitized.name.toLowerCase() === "set-cookie" &&
        isPanelSessionSetCookie(sanitized.value)
      ) {
        continue
      }

      appendResponseHeader(
        event,
        sanitized.name,
        sanitized.name.toLowerCase() === "location"
          ? rewritePanelLocation(sanitized.value, "panel.invalid", getRequestURL(event))
          : sanitized.value,
      )
    }
  }

  setResponseHeader(
    event,
    "Content-Security-Policy",
    getPanelFrameContentSecurityPolicy(
      getResponseHeader(event, "Content-Security-Policy")?.toString(),
      getRequestURL(event),
    ),
  )

  setResponseHeader(event, "Cache-Control", "no-store")

  return await sendStream(event, Readable.from(response.body, { objectMode: false }))
}

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

const requestHeadersToRemove = new Set([...hopByHopHeaders, "cookie", "host"])

function sendPanelError(
  event: Parameters<typeof getHeaders>[0],
  statusCode: number,
  message: string,
): string {
  removeResponseHeader(event, "X-Frame-Options")

  setResponseHeader(
    event,
    "Content-Security-Policy",
    getPanelFrameContentSecurityPolicy(undefined, getRequestURL(event)),
  )

  setResponseHeader(event, "Content-Type", "application/json")
  setResponseStatus(event, statusCode)

  return JSON.stringify({ statusCode, message })
}

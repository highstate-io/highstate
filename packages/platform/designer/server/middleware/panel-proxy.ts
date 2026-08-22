import type { IncomingMessage } from "node:http"
import { getSharedServices } from "@highstate/backend"
import { request as requestHttp } from "node:http"
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
import { readRequestBody } from "../utils/request-body"

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

  const requestBody = readRequestBody(getRequestWebStream(event))
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
    host: upstream.authority,
    "x-highstate-panel-name": upstream.panelName,
    "x-highstate-state-id": upstream.stateId,
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
  headers.host = upstream.authority

  try {
    const bodyChunks = await requestBody
    return await new Promise((resolve, reject) => {
      const request = requestHttp(
        {
          headers,
          hostname: getAuthorityHostname(upstream.authority),
          method: event.method,
          path: event.path,
          port: getAuthorityPort(upstream.authority),
        },
        response => resolve(sendProxyResponse(event, response, upstream.authority)),
      )
      request.once("error", reject)
      event.node.req.once("aborted", () => request.destroy())
      for (const chunk of bodyChunks) {
        request.write(chunk)
      }
      request.end()
    })
  } catch (error) {
    console.error("Panel proxy request failed:", error)
    return sendPanelError(event, 502, "Panel upstream request failed")
  }
})

async function sendProxyResponse(
  event: Parameters<typeof getHeaders>[0],
  response: IncomingMessage,
  upstreamAuthority: string,
): Promise<unknown> {
  setResponseStatus(event, response.statusCode ?? 502)
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index]
    const value = response.rawHeaders[index + 1]
    if (!name || value === undefined) {
      continue
    }
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
          ? rewritePanelLocation(sanitized.value, upstreamAuthority, getRequestURL(event))
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

  return await sendStream(event, response)
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

function getAuthorityHostname(authority: string): string {
  return new URL(`http://${authority}`).hostname
}

function getAuthorityPort(authority: string): number {
  return Number(new URL(`http://${authority}`).port)
}

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

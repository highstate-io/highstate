import { getSharedServices } from "@highstate/backend"
import { getHostedAuthConfig, isHostedAuth } from "../utils/auth-config"
import {
  authenticateHostedSession,
  requireHostedOrigin,
  sessionCookie,
} from "../utils/hosted-session"
import { getPanelIdFromHost } from "../utils/panel-session"

export default defineEventHandler(async event => {
  if (!isHostedAuth()) return
  const config = getHostedAuthConfig()
  if (getRequestURL(event).hostname === "api.highstate.localhost") return
  // isolated panel hosts authenticate their launch capabilities in the panel proxy
  if (getPanelIdFromHost(getHeader(event, "host"))) return
  if (
    event.path.startsWith("/api/auth/") ||
    event.path === "/login" ||
    event.path.startsWith("/_nuxt/")
  )
    return
  const headers = new Headers(getHeaders(event) as Record<string, string>)
  if (!["GET", "HEAD", "OPTIONS"].includes(event.method)) {
    try {
      requireHostedOrigin(headers)
    } catch {
      throw createError({ statusCode: 403, statusMessage: "Invalid request origin" })
    }
  }
  try {
    event.context.designerIdentity = await authenticateHostedSession(
      await getSharedServices(),
      getCookie(event, sessionCookie),
    )
  } catch {
    if (event.path.startsWith("/api/"))
      throw createError({ statusCode: 401, statusMessage: "Authentication required" })
    return sendRedirect(event, `${config.publicUrl.replace(/\/$/, "")}/login`)
  }
})

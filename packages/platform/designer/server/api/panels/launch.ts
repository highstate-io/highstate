import { getHostedAuthConfig, isHostedAuth } from "../../utils/auth-config"
import { authorizePanelSession } from "../../utils/panel-authentication"
import {
  exchangePanelLaunchTicket,
  getPanelIdFromHost,
  getPanelSession,
} from "../../utils/panel-session"

export default defineEventHandler(async event => {
  setHeader(event, "Cache-Control", "no-store")
  setHeader(event, "Referrer-Policy", "no-referrer")
  const panelId = getPanelIdFromHost(getHeader(event, "host"))
  if (!panelId) {
    throw createError({ statusCode: 421, statusMessage: "Misdirected Request" })
  }

  const ticket = getQuery(event).ticket

  const sessionId =
    typeof ticket === "string" ? exchangePanelLaunchTicket(ticket, panelId) : undefined

  if (!sessionId) {
    throw createError({ statusCode: 401, statusMessage: "Invalid panel launch ticket" })
  }

  const session = getPanelSession(sessionId, panelId)
  if (!session) {
    throw createError({ statusCode: 401 })
  }

  await authorizePanelSession(session)

  setCookie(event, "highstate-panel-session", sessionId, {
    httpOnly: true,
    secure: isHostedAuth(),
    domain: isHostedAuth()
      ? `${panelId}.panels.${new URL(getHostedAuthConfig().publicUrl).hostname}`
      : undefined,
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 60 * 60,
  })

  return sendRedirect(event, "/")
})

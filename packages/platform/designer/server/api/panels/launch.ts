import { exchangePanelLaunchTicket, getPanelIdFromHost } from "../../utils/panel-session"

export default defineEventHandler(event => {
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

  setCookie(event, "highstate-panel-session", sessionId, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 60 * 60,
  })

  return sendRedirect(event, "/")
})

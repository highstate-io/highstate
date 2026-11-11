import { getSharedServices } from "@highstate/backend"
import { isHostedAuth } from "../../utils/auth-config"
import {
  cookieOptions,
  hashToken,
  requireHostedOrigin,
  sessionCookie,
} from "../../utils/hosted-session"

export default defineEventHandler(async event => {
  if (isHostedAuth()) {
    try {
      requireHostedOrigin(new Headers(getHeaders(event) as Record<string, string>))
    } catch {
      throw createError({ statusCode: 403, statusMessage: "Invalid request origin" })
    }

    const token = getCookie(event, sessionCookie)
    if (token) {
      const services = await getSharedServices()

      await services.database.backend.designerSession.updateMany({
        where: { tokenHash: hashToken(token) },
        data: { revokedAt: new Date() },
      })
    }

    deleteCookie(event, sessionCookie, cookieOptions)
  }

  return sendRedirect(event, "/login", 303)
})

import { getSharedServices } from "@highstate/backend"
import { getHostedAuthConfig } from "../../utils/auth-config"
import {
  cookieOptions,
  createHostedSession,
  hashToken,
  loginCookie,
  sessionCookie,
} from "../../utils/hosted-session"
import { exchangeLoginCode } from "../../utils/oauth-client"
import { mapLoginProfile } from "../../utils/login-profile"

export default defineEventHandler(async event => {
  setHeader(event, "Cache-Control", "no-store")
  setHeader(event, "Referrer-Policy", "no-referrer")
  const config = getHostedAuthConfig()
  const token = getCookie(event, loginCookie)
  deleteCookie(event, loginCookie, cookieOptions)
  if (!token) throw createError({ statusCode: 401, statusMessage: "Login transaction missing" })
  const services = await getSharedServices()
  try {
    // delete returns the transaction atomically, preventing concurrent callback replay
    const transaction = await services.database.backend.designerLoginTransaction.delete({
      where: { tokenHash: hashToken(token) },
    })
    if (transaction.expiresAt <= new Date()) throw new Error("Login transaction expired")
    const provider = config.providers.find(provider => provider.id === transaction.providerId)
    if (!provider) throw new Error("Login provider removed")
    const url = new URL(`/api/auth/callback${getRequestURL(event).search}`, config.publicUrl)
    const profile = await exchangeLoginCode(provider, url, transaction)
    const identity = mapLoginProfile(provider, profile)
    const previous = getCookie(event, sessionCookie)
    if (previous)
      await services.database.backend.designerSession.updateMany({
        where: { tokenHash: hashToken(previous) },
        data: { revokedAt: new Date() },
      })
    const session = await createHostedSession(services, identity)
    setCookie(event, sessionCookie, session, {
      ...cookieOptions,
      maxAge: config.sessionLifetimeSeconds,
    })
    return sendRedirect(event, "/")
  } catch {
    services.logger.warn("designer login failed")
    throw createError({ statusCode: 401, statusMessage: "Login failed" })
  }
})

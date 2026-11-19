import { getSharedServices } from "@highstate/backend"
import { getHostedAuthConfig } from "../../utils/auth-config"
import {
  createHostedSession,
  getCookieOptions,
  getLoginCookieName,
  getSessionCookieName,
  hashToken,
} from "../../utils/hosted-session"
import { mapLoginProfile } from "../../utils/login-profile"
import { exchangeLoginCode } from "../../utils/oauth-client"

export default defineEventHandler(async event => {
  setHeader(event, "Cache-Control", "no-store")
  setHeader(event, "Referrer-Policy", "no-referrer")
  const config = getHostedAuthConfig()
  const token = getCookie(event, getLoginCookieName())
  deleteCookie(event, getLoginCookieName(), getCookieOptions())

  if (!token) {
    throw createError({ statusCode: 401, statusMessage: "Login transaction missing" })
  }

  const services = await getSharedServices()
  let stage = "transaction"

  try {
    // delete returns the transaction atomically, preventing concurrent callback replay
    const transaction = await services.database.backend.designerLoginTransaction.delete({
      where: { tokenHash: hashToken(token) },
    })

    if (transaction.expiresAt <= new Date()) {
      throw new Error("Login transaction expired")
    }

    const provider = config.providers.find(provider => provider.id === transaction.providerId)
    if (!provider) {
      throw new Error("Login provider removed")
    }

    const url = new URL(`/api/auth/callback${getRequestURL(event).search}`, config.publicUrl)
    stage = "exchange"
    const profile = await exchangeLoginCode(provider, url, transaction)
    stage = "profile"
    const identity = mapLoginProfile(provider, profile)
    const previous = getCookie(event, getSessionCookieName())

    if (previous) {
      await services.database.backend.designerSession.updateMany({
        where: { tokenHash: hashToken(previous) },
        data: { revokedAt: new Date() },
      })
    }

    stage = "session"
    const session = await createHostedSession(services, identity)

    setCookie(event, getSessionCookieName(), session, {
      ...getCookieOptions(),
      maxAge: config.sessionLifetimeSeconds,
    })

    return sendRedirect(event, "/")
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined

    services.logger.warn(
      { stage, code: typeof code === "string" && /^OAUTH_[A-Z_]+$/.test(code) ? code : undefined },
      "designer login failed",
    )

    throw createError({ statusCode: 401, statusMessage: "Login failed" })
  }
})

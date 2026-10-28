import { getSharedServices } from "@highstate/backend"
import * as client from "openid-client"
import { getHostedAuthConfig } from "../../utils/auth-config"
import { cookieOptions, hashToken, loginCookie, opaqueToken } from "../../utils/hosted-session"
import { getLoginClient } from "../../utils/oauth-client"

export default defineEventHandler(async event => {
  const config = getHostedAuthConfig()
  const provider = config.providers.find(provider => provider.id === getQuery(event).provider)
  if (!provider) {
    throw createError({ statusCode: 400, statusMessage: "Unknown login provider" })
  }

  const services = await getSharedServices()
  const token = opaqueToken()

  const transaction = {
    tokenHash: hashToken(token),
    providerId: provider.id,
    state: client.randomState(),
    nonce: client.randomNonce(),
    codeVerifier: client.randomPKCECodeVerifier(),
    expiresAt: new Date(Date.now() + 600000),
  }

  await services.database.backend.designerLoginTransaction.create({ data: transaction })
  setCookie(event, loginCookie, token, { ...cookieOptions, maxAge: 600 })
  setHeader(event, "Cache-Control", "no-store")

  const url = client.buildAuthorizationUrl(await getLoginClient(provider), {
    redirect_uri: `${config.publicUrl.replace(/\/$/, "")}/api/auth/callback`,
    scope: [
      ...new Set([
        ...(provider.identity.protocol === "oidc" ? ["openid"] : []),
        ...provider.scopes,
      ]),
    ].join(" "),
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: await client.calculatePKCECodeChallenge(transaction.codeVerifier),
    code_challenge_method: "S256",
  })

  return sendRedirect(event, url.href)
})

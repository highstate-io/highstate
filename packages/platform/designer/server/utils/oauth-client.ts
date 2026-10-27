import type { LoginProviderConfig } from "@highstate/contract"
import * as client from "openid-client"

const clients = new Map<string, Promise<client.Configuration>>()

export async function createLoginClient(
  provider: LoginProviderConfig,
): Promise<client.Configuration> {
  const auth =
    provider.clientAuthMethod === "none"
      ? client.None()
      : provider.clientAuthMethod === "client_secret_basic"
        ? client.ClientSecretBasic(provider.clientSecret)
        : client.ClientSecretPost(provider.clientSecret)
  if (provider.identity.protocol === "oauth2")
    return new client.Configuration(
      {
        issuer: new URL(provider.tokenEndpoint!).origin,
        authorization_endpoint: provider.authorizationEndpoint,
        token_endpoint: provider.tokenEndpoint,
      },
      provider.clientId,
      undefined,
      auth,
    )
  const discovered = await client.discovery(
    new URL(provider.identity.issuer),
    provider.clientId,
    undefined,
    auth,
  )
  if (discovered.serverMetadata().issuer !== provider.identity.issuer)
    throw new Error("OIDC issuer mismatch")
  const { supportsPKCE: _supportsPKCE, ...metadata } = discovered.serverMetadata()
  const config = new client.Configuration(
    {
      ...metadata,
      authorization_endpoint:
        provider.authorizationEndpoint ?? discovered.serverMetadata().authorization_endpoint,
      token_endpoint: provider.tokenEndpoint ?? discovered.serverMetadata().token_endpoint,
    },
    provider.clientId,
    undefined,
    auth,
  )
  client.enableNonRepudiationChecks(config)
  return config
}

export async function getLoginClient(provider: LoginProviderConfig): Promise<client.Configuration> {
  let config = clients.get(provider.id)
  if (!config) {
    config = createLoginClient(provider)
    clients.set(provider.id, config)
    config.catch(() => clients.delete(provider.id))
  }
  return await config
}

export async function exchangeLoginCode(
  provider: LoginProviderConfig,
  url: URL,
  transaction: { codeVerifier: string; state: string; nonce: string },
): Promise<unknown> {
  const config = await getLoginClient(provider)
  const tokens = await client.authorizationCodeGrant(config, url, {
    pkceCodeVerifier: transaction.codeVerifier,
    expectedState: transaction.state,
    ...(provider.identity.protocol === "oidc"
      ? { expectedNonce: transaction.nonce, idTokenExpected: true }
      : {}),
  })
  if (provider.identity.protocol === "oidc") {
    const claims = tokens.claims()
    if (
      !claims ||
      (claims.azp !== undefined && claims.azp !== provider.clientId) ||
      (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== provider.clientId)
    )
      throw new Error("OIDC authorized party mismatch")
    return claims
  }
  const response = await fetch(provider.identity.userInfoUrl, {
    headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error("OAuth profile request failed")
  return await response.json()
}

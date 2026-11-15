import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto"

export const oidcUsers = {
  admin: { subject: "e2e-admin", name: "E2E Administrator", email: "admin@example.test" },
  reader: { subject: "e2e-reader", name: "E2E Reader", email: "reader@example.test" },
  outsider: { subject: "e2e-outsider", name: "E2E Outsider", email: "outsider@example.test" },
} as const

export type OidcUser = keyof typeof oidcUsers

/**
 * Runs a loopback OIDC provider with real signed tokens, nonce, PKCE, and single-use codes.
 * Designer still performs its normal discovery, callback validation, and session creation.
 */
export function startOidc() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const clientId = "highstate-e2e"
  const clientSecret = randomUUID()
  const keyId = randomUUID()
  let redirectUri: string | undefined
  let issuer = ""

  const codes = new Map<
    string,
    {
      identity: OidcUser
      nonce: string
      challenge: string
      expires: number
    }
  >()

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
          code_challenge_methods_supported: ["S256"],
        })
      }

      if (url.pathname === "/jwks") {
        return Response.json({
          keys: [{ ...publicKey.export({ format: "jwk" }), kid: keyId, alg: "RS256", use: "sig" }],
        })
      }

      if (url.pathname === "/authorize") {
        const params = url.searchParams

        if (
          !redirectUri ||
          params.get("redirect_uri") !== redirectUri ||
          params.get("client_id") !== clientId ||
          params.get("response_type") !== "code" ||
          params.get("code_challenge_method") !== "S256" ||
          !params.get("code_challenge") ||
          !params.get("nonce") ||
          !params.get("state")
        ) {
          return Response.json({ error: "invalid_request" }, { status: 400 })
        }

        const identity = params.get("identity")
        if (!identity) {
          // preserve only validated protocol parameters, escaping all values in HTML
          const escapeHtml = (value: string) =>
            value
              .replaceAll("&", "&amp;")
              .replaceAll('"', "&quot;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")

          const fields = [...params]
            .map(
              ([name, value]) =>
                `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
            )
            .join("")

          return new Response(
            `<!doctype html><title>E2E OIDC</title><h1>Choose test identity</h1><form action="/authorize">${fields}${Object.entries(
              oidcUsers,
            )
              .map(([key, user]) => `<button name="identity" value="${key}">${user.name}</button>`)
              .join("")}</form>`,
            { headers: { "content-type": "text/html; charset=utf-8" } },
          )
        }

        if (!Object.hasOwn(oidcUsers, identity)) {
          return Response.json({ error: "invalid_request" }, { status: 400 })
        }

        const code = randomUUID()

        codes.set(code, {
          identity: identity as OidcUser,
          nonce: params.get("nonce")!,
          challenge: params.get("code_challenge")!,
          expires: Date.now() + 60_000,
        })

        const callback = new URL(redirectUri)
        callback.searchParams.set("code", code)
        callback.searchParams.set("state", params.get("state")!)
        return Response.redirect(callback, 302)
      }

      if (url.pathname === "/token" && request.method === "POST") {
        const [scheme, encoded] = (request.headers.get("authorization") ?? "").split(" ")

        const credentials = Buffer.from(encoded ?? "", "base64")
          .toString()
          .split(":")
          .map(value => decodeURIComponent(value.replaceAll("+", " ")))

        if (
          scheme?.toLowerCase() !== "basic" ||
          credentials[0] !== clientId ||
          credentials[1] !== clientSecret
        ) {
          return Response.json({ error: "invalid_client" }, { status: 401 })
        }

        const params = new URLSearchParams(await request.text())
        const code = params.get("code") ?? ""
        const entry = codes.get(code)
        codes.delete(code)

        if (
          !entry ||
          entry.expires < Date.now() ||
          params.get("grant_type") !== "authorization_code" ||
          params.get("redirect_uri") !== redirectUri ||
          createHash("sha256")
            .update(params.get("code_verifier") ?? "")
            .digest("base64url") !== entry.challenge
        ) {
          return Response.json({ error: "invalid_grant" }, { status: 400 })
        }

        const user = oidcUsers[entry.identity]
        const now = Math.floor(Date.now() / 1000)
        const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
        const payload = `${encode({ alg: "RS256", kid: keyId })}.${encode({ iss: issuer, sub: user.subject, aud: clientId, iat: now, exp: now + 300, nonce: entry.nonce, name: user.name, email: user.email, email_verified: true })}`
        const idToken = `${payload}.${sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url")}`
        return Response.json({
          access_token: randomUUID(),
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken,
        })
      }

      return new Response("Not found", { status: 404 })
    },
  })

  issuer = `http://127.0.0.1:${server.port}`

  return {
    issuer,
    clientId,
    clientSecret,
    setDesignerUrl(url: string) {
      redirectUri = `${url}/api/auth/callback`
    },
    async stop() {
      await server.stop(true)
      codes.clear()
    },
  }
}

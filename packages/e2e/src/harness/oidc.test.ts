import type { JsonWebKey } from "node:crypto"
import { createHash, createPublicKey, verify } from "node:crypto"
import * as client from "openid-client"
import { afterEach, expect, test } from "vitest"
import { startOidc } from "./oidc"

let oidc: ReturnType<typeof startOidc> | undefined
afterEach(async () => await oidc?.stop())

test("the OIDC fixture supports a complete standards-client authorization code exchange", async () => {
  oidc = startOidc()
  oidc.setDesignerUrl("http://127.0.0.1:45678")

  const config = await client.discovery(
    new URL(oidc.issuer),
    oidc.clientId,
    undefined,
    client.ClientSecretBasic(oidc.clientSecret),
    { execute: [client.allowInsecureRequests] },
  )

  client.enableNonRepudiationChecks(config)
  const verifier = client.randomPKCECodeVerifier()
  const state = client.randomState()
  const nonce = client.randomNonce()

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: "http://127.0.0.1:45678/api/auth/callback",
    scope: "openid profile email",
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
    identity: "admin",
  })

  const redirect = await fetch(url, { redirect: "manual" })

  const tokens = await client
    .authorizationCodeGrant(config, new URL(redirect.headers.get("location")!), {
      pkceCodeVerifier: verifier,
      expectedState: state,
      expectedNonce: nonce,
      idTokenExpected: true,
    })
    .catch(error => {
      throw new Error(`OIDC exchange failed: ${error.error} ${JSON.stringify(error.cause)}`, {
        cause: error,
      })
    })

  expect(tokens.claims()).toMatchObject({ sub: "e2e-admin", email: "admin@example.test" })
})

test("validates redirect, PKCE, client credentials, and single-use codes before signing an OIDC identity", async () => {
  oidc = startOidc()
  oidc.setDesignerUrl("http://127.0.0.1:45678")
  const verifier = "disposable-test-pkce-verifier"
  const url = new URL(`${oidc.issuer}/authorize`)

  url.search = new URLSearchParams({
    client_id: oidc.clientId,
    redirect_uri: "http://foreign.example.test/api/auth/callback",
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    nonce: "test-nonce",
    state: "test-state",
    identity: "reader",
  }).toString()

  expect((await fetch(url, { redirect: "manual" })).status).toBe(400)
  url.searchParams.set("redirect_uri", "http://127.0.0.1:45678/api/auth/callback")
  const redirect = await fetch(url, { redirect: "manual" })
  const callback = new URL(redirect.headers.get("location")!)
  expect(callback.searchParams.get("state")).toBe("test-state")

  const body = new URLSearchParams({
    code: callback.searchParams.get("code")!,
    redirect_uri: url.searchParams.get("redirect_uri")!,
    grant_type: "authorization_code",
    code_verifier: verifier,
  })

  expect((await fetch(`${oidc.issuer}/token`, { method: "POST", body })).status).toBe(401)

  const headers = {
    authorization: `Basic ${Buffer.from(`${oidc.clientId}:${oidc.clientSecret}`).toString("base64")}`,
  }

  const response = await fetch(`${oidc.issuer}/token`, { method: "POST", headers, body })
  expect(response.status).toBe(200)
  const token = ((await response.json()) as { id_token: string }).id_token
  const [header, payload, signature] = token.split(".")
  const jwks = (await (await fetch(`${oidc.issuer}/jwks`)).json()) as { keys: JsonWebKey[] }

  expect(
    verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      createPublicKey({ key: jwks.keys[0]!, format: "jwk" }),
      Buffer.from(signature!, "base64url"),
    ),
  ).toBe(true)

  expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toMatchObject({
    iss: oidc.issuer,
    sub: "e2e-reader",
    aud: oidc.clientId,
    nonce: "test-nonce",
  })

  expect((await fetch(`${oidc.issuer}/token`, { method: "POST", headers, body })).status).toBe(400)
})

test("rejects the wrong PKCE verifier and consumes the authorization code", async () => {
  oidc = startOidc()
  oidc.setDesignerUrl("http://127.0.0.1:45678")

  const params = new URLSearchParams({
    client_id: oidc.clientId,
    redirect_uri: "http://127.0.0.1:45678/api/auth/callback",
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update("correct-verifier").digest("base64url"),
    nonce: "nonce",
    state: "state",
    identity: "admin",
  })

  const redirect = await fetch(`${oidc.issuer}/authorize?${params}`, { redirect: "manual" })
  const code = new URL(redirect.headers.get("location")!).searchParams.get("code")!

  const body = new URLSearchParams({
    code,
    redirect_uri: params.get("redirect_uri")!,
    grant_type: "authorization_code",
    code_verifier: "wrong",
  })

  const response = await fetch(`${oidc.issuer}/token`, {
    method: "POST",
    body,
    headers: {
      authorization: `Basic ${Buffer.from(`${oidc.clientId}:${oidc.clientSecret}`).toString("base64")}`,
    },
  })

  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: "invalid_grant" })
  body.set("code_verifier", "correct-verifier")

  const replay = await fetch(`${oidc.issuer}/token`, {
    method: "POST",
    body,
    headers: {
      authorization: `Basic ${Buffer.from(`${oidc.clientId}:${oidc.clientSecret}`).toString("base64")}`,
    },
  })

  expect(replay.status).toBe(400)
})

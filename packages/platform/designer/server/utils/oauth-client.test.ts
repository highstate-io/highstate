import { loginProviderConfigSchema } from "@highstate/contract"
import * as client from "openid-client"
import { afterEach, describe, expect, test, vi } from "vitest"
import { createLoginClient, exchangeLoginCode } from "./oauth-client"

afterEach(() => vi.unstubAllGlobals())

describe("maintained OAuth/OIDC validation", () => {
  const provider = loginProviderConfigSchema.parse({
    id: "test",
    title: "Test",
    clientId: "client",
    clientAuthMethod: "none",
    identity: { protocol: "oidc", issuer: "https://issuer.example" },
  })

  test("rejects discovery issuer substitution", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          issuer: "https://attacker.example",
          authorization_endpoint: "https://attacker.example/auth",
          token_endpoint: "https://attacker.example/token",
        }),
      ),
    )

    await expect(createLoginClient(provider)).rejects.toThrow()
  })

  test("rejects state mismatch before exchanging a code", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        issuer: "https://issuer.example",
        authorization_endpoint: "https://issuer.example/auth",
        token_endpoint: "https://issuer.example/token",
        jwks_uri: "https://issuer.example/jwks",
      }),
    )

    vi.stubGlobal("fetch", fetch)
    const config = await createLoginClient(provider)

    await expect(
      client.authorizationCodeGrant(
        config,
        new URL("https://designer.example/api/auth/callback?code=code&state=attacker"),
        {
          expectedState: "browser-state",
          pkceCodeVerifier: client.randomPKCECodeVerifier(),
          expectedNonce: "nonce",
          idTokenExpected: true,
        },
      ),
    ).rejects.toThrow()

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test.each([
    "valid",
    "valid-multiple-audiences",
    "issuer",
    "audience",
    "nonce",
    "signature",
    "expired",
    "missing-nonce",
    "authorized-party",
    "multiple-audiences-without-authorized-party",
  ])("validates signed ID tokens: %s", async failure => {
    const algorithm = {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    }

    const keys = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"])

    const advertised =
      failure === "signature"
        ? await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"])
        : keys

    const jwk = await crypto.subtle.exportKey("jwk", advertised.publicKey)
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
    const now = Math.floor(Date.now() / 1000)

    const claims = {
      iss: failure === "issuer" ? "https://other.example" : "https://issuer.example",
      aud: failure.includes("multiple-audiences")
        ? ["client", "other-client"]
        : failure === "audience"
          ? "other-client"
          : "client",
      sub: "subject",
      nonce:
        failure === "missing-nonce" ? undefined : failure === "nonce" ? "other-nonce" : "nonce",
      azp:
        failure === "valid-multiple-audiences"
          ? "client"
          : failure === "authorized-party"
            ? "other-client"
            : undefined,
      iat: now,
      exp: failure === "expired" ? now - 120 : now + 60,
    }

    const data = `${encode({ alg: "RS256", kid: "key" })}.${encode(claims)}`

    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keys.privateKey,
      new TextEncoder().encode(data),
    )

    const idToken = `${data}.${Buffer.from(signature).toString("base64url")}`
    const verifier = client.randomPKCECodeVerifier()

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        if (String(url).endsWith("/token")) {
          expect(new URLSearchParams(String(init?.body)).get("code_verifier")).toBe(verifier)
          return Response.json({ access_token: "access", token_type: "Bearer", id_token: idToken })
        }

        if (String(url).endsWith("/jwks")) {
          return Response.json({ keys: [{ ...jwk, kid: "key", alg: "RS256", use: "sig" }] })
        }

        return Response.json({
          issuer: "https://issuer.example",
          authorization_endpoint: "https://issuer.example/auth",
          token_endpoint: "https://issuer.example/token",
          jwks_uri: "https://issuer.example/jwks",
          id_token_signing_alg_values_supported: ["RS256"],
        })
      }),
    )

    const result = exchangeLoginCode(
      { ...provider, id: `signed-${failure}` },
      new URL("https://designer.example/api/auth/callback?code=code&state=state"),
      {
        state: "state",
        nonce: "nonce",
        codeVerifier: verifier,
      },
    )

    if (failure.startsWith("valid")) {
      expect(await result).toMatchObject({ sub: "subject" })
    } else {
      await expect(result).rejects.toThrow()
    }
  })
})

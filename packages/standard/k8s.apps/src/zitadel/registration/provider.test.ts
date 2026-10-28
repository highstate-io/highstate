import { afterEach, describe, expect, test } from "bun:test"
import { type ApplicationInputs, ApplicationProvider, applicationCallback } from "./provider"

const servers: ReturnType<typeof Bun.serve>[] = []
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true)
  }
})

describe("Zitadel application lifecycle", () => {
  test("creates once, refreshes drift, updates without rotating credentials and deletes idempotently", async () => {
    const requests: { method: string; path: string; body: Record<string, unknown> }[] = []
    let app: { name: string; oidcConfig: Record<string, unknown> } | undefined

    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        expect(request.headers.get("authorization")).toBe("Bearer automation-token")
        expect(request.headers.get("x-zitadel-orgid")).toBe("org")
        const path = new URL(request.url).pathname

        const body =
          request.method === "POST" || request.method === "PUT"
            ? ((await request.json()) as Record<string, unknown>)
            : {}

        requests.push({ method: request.method, path, body })

        if (request.method === "POST") {
          expect(path).toBe("/management/v1/projects/project/apps/oidc")
          app = { name: body.name as string, oidcConfig: { ...body, clientId: "client" } }
          return Response.json({
            appId: "application",
            clientId: "client",
            clientSecret: "one-time-secret",
          })
        }

        if (!app) {
          return Response.json({}, { status: 404 })
        }

        if (request.method === "GET") {
          return Response.json({ app })
        }

        if (request.method === "DELETE") {
          app = undefined
        } else if (path.endsWith("/oidc_config")) {
          app.oidcConfig = { ...body, clientId: "client" }
        } else {
          app.name = body.name as string
        }

        return Response.json({})
      },
    })

    servers.push(server)
    const provider = new ApplicationProvider()

    const inputs: ApplicationInputs = {
      issuer: server.url.origin,
      token: "automation-token",
      organizationId: "org",
      projectId: "project",
      name: "Highstate",
      redirectUris: [applicationCallback("highstate.example.com", "/auth/callback")],
    }

    const created = await provider.create(inputs)
    const state = created.outs!
    expect((await provider.diff(created.id, state, inputs)).changes).toBe(false)
    const refreshed = await provider.read(created.id, state)
    expect(refreshed.props?.clientSecret).toBe("one-time-secret")
    expect((await provider.diff(created.id, refreshed.props!, inputs)).changes).toBe(false)

    // simulate out-of-band edits, including weakening confidential client authentication
    app!.name = "Renamed elsewhere"
    app!.oidcConfig.authMethodType = "OIDC_AUTH_METHOD_TYPE_NONE"
    app!.oidcConfig.redirectUris = ["https://old.example.com/callback"]
    const drift = await provider.read(created.id, state)
    expect((await provider.diff(created.id, drift.props!, inputs)).changes).toBe(true)
    const updated = await provider.update(created.id, drift.props!, inputs)
    expect(updated.outs?.clientSecret).toBe("one-time-secret")
    expect(app?.name).toBe(inputs.name)
    expect(app?.oidcConfig.redirectUris).toEqual(inputs.redirectUris)
    expect(app?.oidcConfig.authMethodType).toBe("OIDC_AUTH_METHOD_TYPE_BASIC")
    expect(requests.filter(request => request.method === "POST")).toHaveLength(1)

    const beforeRotation = requests.length
    await provider.update(created.id, state, { ...inputs, token: "rotated" })
    expect(requests).toHaveLength(beforeRotation)

    expect(
      (await provider.diff(created.id, state, { ...inputs, projectId: "another" })).replaces,
    ).toEqual(["projectId"])

    await provider.delete(created.id, state)
    await provider.delete(created.id, state)
    expect((await provider.read(created.id, state)).id).toBeUndefined()
  })

  test("does not treat permission errors as deletion or expose API response secrets", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ message: "sensitive-token" }, { status: 403 }),
    })

    servers.push(server)

    const state = {
      issuer: server.url.origin,
      token: "token",
      organizationId: "org",
      projectId: "project",
      name: "App",
      redirectUris: [],
      clientId: "id",
      clientSecret: "secret",
      configurationDrift: false,
    }

    await expect(new ApplicationProvider().read("app", state)).rejects.toThrow(
      "Zitadel GET request failed with HTTP 403",
    )
  })
})

test("callback construction rejects origin replacement and fragments", () => {
  expect(applicationCallback("app.example.com", "/auth/callback")).toBe(
    "https://app.example.com/auth/callback",
  )

  expect(() => applicationCallback("app.example.com", "//other.example.com/callback")).toThrow()
  expect(() => applicationCallback("app.example.com", "/callback#fragment")).toThrow()
})

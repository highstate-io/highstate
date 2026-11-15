import type { ProjectNpmRegistryProvider } from "./npm"
import { createServer } from "node:http"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { getNpmPackageInfo, registryScopes, searchNpmPackages } from "./npm-explorer"

describe("npm package explorer", () => {
  let origin = ""
  const requests: { path: string; authorization?: string }[] = []

  const server = createServer((request, response) => {
    const path = request.url!
    requests.push({ path, authorization: request.headers.authorization })
    response.setHeader("content-type", "application/json")

    if (path.startsWith("/private/-/v1/search")) {
      response.statusCode = 404
      response.end("{}")
    } else if (path.startsWith("/public/-/v1/search")) {
      response.end(
        JSON.stringify({
          objects: [
            { package: { name: "example", version: "2.0.0", description: "Example library" } },
            { package: { name: "@private/example", version: "1.0.0" } },
          ],
          total: 50,
        }),
      )
    } else if (path === "/private/%40private%2Fexample" || path === "/public/example") {
      response.end(
        JSON.stringify({
          name: path.startsWith("/private") ? "@private/example" : "example",
          description: "Example library",
          readme: "# Example\n<script>not HTML</script>",
          license: "MIT",
          "dist-tags": { latest: "2.0.0" },
          time: { "2.0.0": "2026-01-01T00:00:00Z" },
          versions: { "1.0.0": { deprecated: "Use 2.0.0" }, "2.0.0": {}, "not-a-version": {} },
        }),
      )
    } else {
      response.statusCode = 404
      response.end("{}")
    }
  })

  const provider: ProjectNpmRegistryProvider = {
    forPackage: async (_projectId, name) =>
      name.startsWith("@private/")
        ? { registryUrl: `${origin}/private/`, token: "private-token" }
        : { registryUrl: `${origin}/public/` },
    scopes: async () => ({
      "@private": { registryUrl: `${origin}/private/`, token: "private-token" },
    }),
  }

  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") {
      throw new Error("No registry address")
    }

    origin = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    )
  })

  it("uses npm search pagination and excludes results routed to another registry", async () => {
    const result = await searchNpmPackages(provider, "project", {
      query: "example",
      scope: "",
      offset: 25,
    })

    expect(result).toEqual({
      packages: [{ name: "example", version: "2.0.0", description: "Example library" }],
      total: 50,
      searchable: true,
    })

    const request = requests.find(item => item.path.startsWith("/public/-/v1/search"))!
    expect(new URL(request.path, origin).searchParams.get("from")).toBe("25")
    expect(request.authorization).toBeUndefined()
  })

  it("supports authenticated exact-name lookup when a registry has no search endpoint", async () => {
    const result = await searchNpmPackages(provider, "project", {
      query: "@private/example",
      scope: "@private",
      offset: 0,
    })

    expect(result.searchable).toBe(false)
    expect(result.packages.map(item => item.name)).toEqual(["@private/example"])

    expect(
      requests.find(item => item.path === "/private/%40private%2Fexample")?.authorization,
    ).toBe("Bearer private-token")

    expect(
      await searchNpmPackages(provider, "project", {
        query: "example",
        scope: "@private",
        offset: 0,
      }),
    ).toEqual({ packages: [], total: 0, searchable: false })
  })

  it("exposes release tags, valid exact releases, dates, deprecations and plain README", async () => {
    const info = await getNpmPackageInfo(provider, "project", "example")
    expect(info.tags).toEqual({ latest: "2.0.0" })

    expect(info.versions).toEqual([
      { version: "2.0.0", publishedAt: "2026-01-01T00:00:00Z", deprecated: undefined },
      { version: "1.0.0", publishedAt: undefined, deprecated: "Use 2.0.0" },
    ])

    expect(info.readme).toContain("<script>not HTML</script>")
    expect(Object.values(await registryScopes(provider, "project"))).toHaveLength(2)
  })

  it("rejects unknown registry scopes before network access", async () => {
    const count = requests.length

    await expect(
      searchNpmPackages(provider, "project", {
        query: "example",
        scope: "https://evil.invalid",
        offset: 0,
      }),
    ).rejects.toThrow("not configured")

    expect(requests).toHaveLength(count)
  })
})

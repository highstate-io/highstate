import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  getRemoteConfigPath,
  readRemoteConfig,
  resolveRemoteTarget,
  validateContextName,
  writeRemoteConfig,
} from "./remote-context"

const paths: string[] = []

afterEach(async () => {
  await Promise.all(paths.splice(0).map(path => Bun.file(path).delete()))
})

describe("remote context configuration", () => {
  it("uses HIGHSTATE_CONFIG_PATH and persists no credentials", async () => {
    const path = join("/tmp", `highstate-cli-${crypto.randomUUID()}.json`)
    paths.push(path)
    const env = { HIGHSTATE_CONFIG_PATH: path }

    await writeRemoteConfig(
      {
        activeContext: "local",
        contexts: { local: { apiUrl: "http://localhost:7283", projectId: "project" } },
      },
      env,
    )

    expect(getRemoteConfigPath(env)).toBe(path)
    expect(await readRemoteConfig(env)).toEqual({
      activeContext: "local",
      contexts: { local: { apiUrl: "http://localhost:7283", projectId: "project" } },
    })
    expect(await readFile(path, "utf8")).not.toContain("token")
  })

  it("validates context names", () => {
    expect(validateContextName("production.eu-1")).toBe("production.eu-1")
    expect(() => validateContextName("bad context")).toThrow()
  })

  it("resolves flags before environment and context values", async () => {
    const path = join("/tmp", `highstate-cli-${crypto.randomUUID()}.json`)
    paths.push(path)
    const env = {
      HIGHSTATE_CONFIG_PATH: path,
      HIGHSTATE_API_URL: "https://environment.example.com",
      HIGHSTATE_API_TOKEN: "environment-token",
      HIGHSTATE_PROJECT_ID: "environment-project",
    }
    await writeRemoteConfig(
      {
        activeContext: "local",
        contexts: {
          local: { apiUrl: "https://context.example.com", projectId: "context-project" },
        },
      },
      env,
    )

    await expect(
      resolveRemoteTarget(
        { apiUrl: "https://flag.example.com", projectId: "flag-project" },
        { requireProject: true, env },
      ),
    ).resolves.toEqual({
      contextName: "local",
      apiUrl: "https://flag.example.com",
      apiToken: "environment-token",
      projectId: "flag-project",
    })
  })
})

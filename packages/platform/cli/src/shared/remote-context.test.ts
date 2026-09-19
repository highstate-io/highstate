import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const keyring = vi.hoisted(() => ({
  setPassword: vi.fn(),
  getPassword: vi.fn(),
  deleteCredential: vi.fn(),
}))

vi.mock("@napi-rs/keyring", () => ({
  AsyncEntry: class {
    setPassword = keyring.setPassword
    getPassword = keyring.getPassword
    deleteCredential = keyring.deleteCredential
  },
}))

import {
  assertKeyringAvailable,
  getContextToken,
  getRemoteConfigPath,
  normalizeApiUrl,
  readRemoteConfig,
  resolveRemoteTarget,
  setContextToken,
  validateContextName,
  writeRemoteConfig,
} from "./remote-context"

const paths: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
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

  it("normalizes context API URLs", () => {
    expect(normalizeApiUrl("api.highstate.localhost:3000")).toBe(
      "http://api.highstate.localhost:3000",
    )
    expect(normalizeApiUrl("https://api.example.com/")).toBe("https://api.example.com")
    expect(normalizeApiUrl("unix:///var/run/highstate.sock")).toBe("unix:///var/run/highstate.sock")
  })

  it("rejects unsupported context API URL protocols", () => {
    expect(() => normalizeApiUrl("ftp://api.example.com")).toThrow(
      'Unsupported Highstate API URL protocol "ftp:"; use http, https, or unix',
    )
  })

  it("reports non-error keyring rejections", async () => {
    keyring.setPassword.mockRejectedValueOnce({ code: "GenericFailure" })

    await expect(setContextToken("main", "secret")).rejects.toThrow(
      'Failed to store the API token for Highstate context "main" in the system keyring (GenericFailure); ensure a keyring or secret service is available',
    )
  })

  it("reports an unavailable keyring during the probe", async () => {
    keyring.setPassword.mockRejectedValueOnce({ code: "GenericFailure" })
    const probe = assertKeyringAvailable()

    await expect(probe).rejects.toThrow(
      "System keyring is unavailable; ensure a keyring or secret service is available",
    )

    await probe.catch(error => {
      expect(error).toMatchObject({ details: "GenericFailure" })
    })
  })

  it("probes keyring write, read, and deletion", async () => {
    keyring.getPassword.mockResolvedValueOnce("probe-value")
    vi.stubGlobal("crypto", { randomUUID: () => "value" })

    await assertKeyringAvailable()

    expect(keyring.setPassword).toHaveBeenCalledWith("probe-value")
    expect(keyring.getPassword).toHaveBeenCalledOnce()
    expect(keyring.deleteCredential).toHaveBeenCalledOnce()
  })

  it("reads plaintext context tokens without accessing the keyring", async () => {
    await expect(
      getContextToken("main", { apiUrl: "https://example.com", apiToken: "plaintext-token" }),
    ).resolves.toBe("plaintext-token")
    expect(keyring.getPassword).not.toHaveBeenCalled()
  })

  it("persists and resolves plaintext context tokens", async () => {
    const path = join("/tmp", `highstate-cli-${crypto.randomUUID()}.json`)
    paths.push(path)
    const env = { HIGHSTATE_CONFIG_PATH: path }

    await writeRemoteConfig(
      {
        activeContext: "main",
        contexts: {
          main: { apiUrl: "https://example.com", apiToken: "plaintext-token" },
        },
      },
      env,
    )

    await expect(resolveRemoteTarget({}, { env })).resolves.toEqual({
      contextName: "main",
      apiUrl: "https://example.com",
      apiToken: "plaintext-token",
    })
    expect(keyring.getPassword).not.toHaveBeenCalled()
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

import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateIdentity } from "age-encryption"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type BackendIdentityConfig, getOrCreateBackendIdentity } from "./keyring"

const createLogger = () => ({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
})

describe("getOrCreateBackendIdentity", () => {
  let tempFilePath: string

  beforeEach(() => {
    tempFilePath = join(tmpdir(), `test-identity-${Date.now()}.key`)
  })

  afterEach(async () => {
    try {
      const { unlink } = await import("node:fs/promises")
      await unlink(tempFilePath)
    } catch {
      // ignore cleanup errors
    }
  })

  it("returns identity from HIGHSTATE_BACKEND_DATABASE_IDENTITY", async () => {
    const testIdentity = await generateIdentity()
    const config: BackendIdentityConfig = {
      HIGHSTATE_BACKEND_DATABASE_IDENTITY: testIdentity,
    }

    const identity = await getOrCreateBackendIdentity(config, createLogger() as any)

    expect(identity).toBe(testIdentity)
  })

  it("loads identity from HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH", async () => {
    const testIdentity = await generateIdentity()
    await writeFile(tempFilePath, testIdentity)

    const config: BackendIdentityConfig = {
      HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH: tempFilePath,
    }

    const identity = await getOrCreateBackendIdentity(config, createLogger() as any)

    expect(identity).toBe(testIdentity)
  })

  it("trims whitespace from file-based identity", async () => {
    const testIdentity = await generateIdentity()
    await writeFile(tempFilePath, `  ${testIdentity}\n\n`)

    const config: BackendIdentityConfig = {
      HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH: tempFilePath,
    }

    const identity = await getOrCreateBackendIdentity(config, createLogger() as any)

    expect(identity).toBe(testIdentity)
  })

  it("throws error if identity file does not exist", async () => {
    const config: BackendIdentityConfig = {
      HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH: "/nonexistent/path/to/identity.key",
    }

    await expect(
      getOrCreateBackendIdentity(config, createLogger() as any),
    ).rejects.toThrow('Failed to read backend identity from "/nonexistent/path/to/identity.key"')
  })

  it("prioritizes HIGHSTATE_BACKEND_DATABASE_IDENTITY over PATH", async () => {
    const directIdentity = await generateIdentity()
    const fileIdentity = await generateIdentity()
    await writeFile(tempFilePath, fileIdentity)

    const config: BackendIdentityConfig = {
      HIGHSTATE_BACKEND_DATABASE_IDENTITY: directIdentity,
      HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH: tempFilePath,
    }

    const identity = await getOrCreateBackendIdentity(config, createLogger() as any)

    expect(identity).toBe(directIdentity)
  })
})

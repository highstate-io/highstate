import { identityToRecipient } from "age-encryption"
import { beforeEach, describe, expect, test, vi } from "vitest"

const keyring = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  find: vi.fn(),
  write: vi.fn(),
}))

vi.mock("@napi-rs/keyring", () => ({
  findCredentialsAsync: keyring.find,
  AsyncEntry: class {
    constructor(
      _service: string,
      private account: string,
    ) {}

    async setPassword(value: string) {
      keyring.write(value)
      keyring.entries.set(this.account, value)
    }

    async getPassword() {
      return keyring.entries.get(this.account)
    }

    async deleteCredential() {
      keyring.entries.delete(this.account)
    }
  },
}))

import { ProjectKeyring } from "./project-keyring"

describe("ProjectKeyring", () => {
  beforeEach(() => {
    keyring.entries.clear()
    keyring.write.mockReset()

    keyring.find
      .mockReset()
      .mockImplementation(async () =>
        [...keyring.entries].map(([account, password]) => ({ account, password })),
      )
  })

  test("reuses one identity across projects, concurrent creation, and service restarts", async () => {
    const store = new ProjectKeyring()

    const [first, second] = await Promise.all([
      store.getOrCreateRecipient(),
      store.getOrCreateRecipient(),
    ])

    expect(first).toBe(second)
    expect(await new ProjectKeyring().getOrCreateRecipient()).toBe(first)
    expect(keyring.write).toHaveBeenCalledTimes(1)
    expect(await identityToRecipient(await store.getIdentity(first))).toBe(first)
  })

  test("does not recreate a missing identity when unlocking a transferred project", async () => {
    const store = new ProjectKeyring()
    const recipient = await store.getOrCreateRecipient()
    keyring.entries.clear()
    keyring.write.mockClear()
    await expect(store.getIdentity(recipient)).rejects.toThrow("not available on this backend")
    expect(keyring.write).not.toHaveBeenCalled()
  })

  test("does not use a different backend's identity", async () => {
    const store = new ProjectKeyring()
    const oldRecipient = await store.getOrCreateRecipient()
    keyring.entries.clear()
    await store.getOrCreateRecipient()
    await expect(store.getIdentity(oldRecipient)).rejects.toThrow("not available on this backend")
  })

  test("probes keyring access without leaving credentials or replacing an identity", async () => {
    const store = new ProjectKeyring()
    await store.checkAvailable()
    expect(keyring.entries.size).toBe(0)
    const recipient = await store.getOrCreateRecipient()
    await store.checkAvailable()
    expect(keyring.entries.size).toBe(1)
    expect(await store.getOrCreateRecipient()).toBe(recipient)
  })

  test("does not overwrite an existing identity when the keyring cannot be read", async () => {
    keyring.find.mockRejectedValueOnce(new Error("Locked"))
    await expect(new ProjectKeyring().getOrCreateRecipient()).rejects.toThrow("Failed to read")
    expect(keyring.write).not.toHaveBeenCalled()
  })
})

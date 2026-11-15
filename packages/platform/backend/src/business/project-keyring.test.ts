import { identityToRecipient } from "age-encryption"
import { beforeEach, describe, expect, test, vi } from "vitest"

const keyring = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  find: vi.fn(),
  write: vi.fn(),
}))

class TestKeyringStorage {
  read = keyring.find

  async write(account: string, value: string) {
    keyring.write(value)
    keyring.entries.set(account, value)
  }

  async probe() {}
}

import { ProjectKeyring as RealProjectKeyring } from "./project-keyring"

class ProjectKeyring extends RealProjectKeyring {
  constructor() {
    super(new TestKeyringStorage())
  }
}

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
      store.getOrCreateEnvelope(),
      store.getOrCreateEnvelope(),
    ])

    expect(first).toBe(second)
    expect(await new ProjectKeyring().getOrCreateEnvelope()).toEqual(first)
    expect(keyring.write).toHaveBeenCalledTimes(2)

    expect(
      await identityToRecipient(await store.getIdentity(first.recipient, first.encryptedIdentity)),
    ).toBe(first.recipient)

    expect(await identityToRecipient(keyring.entries.get("identity")!)).not.toBe(first.recipient)
    expect(first.encryptedIdentity).toContain("AGE ENCRYPTED FILE")
  })

  test("does not recreate a missing identity when unlocking a transferred project", async () => {
    const store = new ProjectKeyring()
    const envelope = await store.getOrCreateEnvelope()
    keyring.entries.clear()
    keyring.write.mockClear()

    await expect(store.getIdentity(envelope.recipient, envelope.encryptedIdentity)).rejects.toThrow(
      "not available on this backend",
    )

    expect(keyring.write).not.toHaveBeenCalled()
  })

  test("does not use a different backend's identity", async () => {
    const store = new ProjectKeyring()
    const envelope = await store.getOrCreateEnvelope()
    keyring.entries.clear()
    await store.getOrCreateEnvelope()

    await expect(
      store.getIdentity(envelope.recipient, envelope.encryptedIdentity),
    ).rejects.toThrow()
  })

  test("does not overwrite an existing identity when the keyring cannot be read", async () => {
    keyring.find.mockRejectedValueOnce(new Error("Locked"))
    await expect(new ProjectKeyring().getOrCreateEnvelope()).rejects.toThrow("Failed to prepare")
    expect(keyring.write).not.toHaveBeenCalled()
  })

  test("unlocks from the project's envelope even if the cached envelope is lost", async () => {
    const store = new ProjectKeyring()
    const envelope = await store.getOrCreateEnvelope()
    keyring.entries.delete("unlock-envelope")
    keyring.write.mockClear()

    expect(
      await identityToRecipient(
        await store.getIdentity(envelope.recipient, envelope.encryptedIdentity),
      ),
    ).toBe(envelope.recipient)

    expect(keyring.write).not.toHaveBeenCalled()
  })

  test("does not replace a missing wrapper or a corrupt envelope", async () => {
    const store = new ProjectKeyring()
    await store.getOrCreateEnvelope()
    const wrapper = keyring.entries.get("identity")!
    keyring.entries.delete("identity")
    keyring.write.mockClear()
    await expect(store.getOrCreateEnvelope()).rejects.toThrow("Failed to prepare")
    expect(keyring.write).not.toHaveBeenCalled()
    keyring.entries.set("identity", wrapper)
    keyring.entries.set("unlock-envelope", "corrupt")
    await expect(store.getOrCreateEnvelope()).rejects.toThrow()
    expect(keyring.write).not.toHaveBeenCalled()
  })

  test("preserves direct-recipient methods from before envelope support", async () => {
    const store = new ProjectKeyring()
    await store.getOrCreateEnvelope()
    const wrapper = keyring.entries.get("identity")!
    expect(await store.getIdentity(await identityToRecipient(wrapper))).toBe(wrapper)
  })
})

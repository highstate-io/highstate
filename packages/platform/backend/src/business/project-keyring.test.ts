import { identityToRecipient } from "age-encryption"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { ProjectKeyring as RealProjectKeyring } from "./project-keyring"

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

  test("reuses one keyring entry while keeping envelopes project-local across concurrent creation and restarts", async () => {
    const store = new ProjectKeyring()

    const [first, second] = await Promise.all([
      store.getOrCreateEnvelope(),
      store.getOrCreateEnvelope(),
    ])

    const third = await new ProjectKeyring().getOrCreateEnvelope()
    expect(new Set([first.recipient, second.recipient, third.recipient]).size).toBe(3)
    expect(keyring.write).toHaveBeenCalledOnce()
    expect([...keyring.entries.keys()]).toEqual(["identity"])

    for (const envelope of [first, second, third]) {
      expect(
        await identityToRecipient(
          await store.getIdentity(envelope.recipient, envelope.encryptedIdentity),
        ),
      ).toBe(envelope.recipient)
    }

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

  test("does not depend on an extra keyring envelope entry", async () => {
    const store = new ProjectKeyring()
    const envelope = await store.getOrCreateEnvelope()
    expect([...keyring.entries.keys()]).toEqual(["identity"])
    keyring.write.mockClear()

    expect(
      await identityToRecipient(
        await store.getIdentity(envelope.recipient, envelope.encryptedIdentity),
      ),
    ).toBe(envelope.recipient)

    expect(keyring.write).not.toHaveBeenCalled()
  })

  test("rejects corrupt project envelopes without changing the keyring", async () => {
    const store = new ProjectKeyring()
    const envelope = await store.getOrCreateEnvelope()
    keyring.write.mockClear()
    await expect(store.getIdentity(envelope.recipient, "corrupt")).rejects.toThrow()
    expect(keyring.write).not.toHaveBeenCalled()
  })
})

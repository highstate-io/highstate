import { beforeEach, describe, expect, test, vi } from "vitest"
import { createPasskeyUnlockMethod, createUnlockMethodFromForm } from "."

const mocks = vi.hoisted(() => ({
  createCredential: vi.fn(),
  recipientOptions: vi.fn(),
  decrypt: vi.fn(),
  identityOptions: vi.fn(),
  encrypt: vi.fn(),
}))

vi.mock("age-encryption", () => ({
  armor: {
    encode: vi.fn(() => "armored identity"),
    decode: vi.fn(() => new Uint8Array()),
  },
  Decrypter: class {
    addIdentity(): void {}

    decrypt = mocks.decrypt
  },
  Encrypter: class {
    addRecipient(): void {}

    encrypt = mocks.encrypt
  },
  generateIdentity: vi.fn(async () => "identity"),
  identityToRecipient: vi.fn(async () => "recipient"),
  webauthn: {
    createCredential: mocks.createCredential,
    WebAuthnRecipient: class {
      constructor(options: unknown) {
        mocks.recipientOptions(options)
      }
    },
    WebAuthnIdentity: class {
      constructor(options: unknown) {
        mocks.identityOptions(options)
      }
    },
  },
}))

describe("createPasskeyUnlockMethod", () => {
  beforeEach(() => {
    mocks.createCredential.mockReset()
    mocks.recipientOptions.mockReset()
    mocks.decrypt.mockReset().mockResolvedValue("identity")
    mocks.identityOptions.mockReset()
    mocks.encrypt.mockReset().mockResolvedValue(new Uint8Array())
  })

  test("discovers an existing RP passkey without creating a credential or loading another project", async () => {
    const unlockMethod = await createPasskeyUnlockMethod(
      {
        title: "YubiKey",
        description: "",
      },
      { id: "project-id", name: "home-lab" },
    )

    expect(mocks.createCredential).not.toHaveBeenCalled()
    expect(mocks.recipientOptions).toHaveBeenCalledWith(undefined)
    expect(mocks.encrypt).toHaveBeenCalledWith("identity")

    expect(unlockMethod).toEqual({
      type: "passkey",
      meta: {
        title: "YubiKey",
        description: "",
      },
      encryptedIdentity: "armored identity",
      recipient: "recipient",
    })
  })

  test("does not enroll for unsupported PRF or unrelated failures", async () => {
    mocks.encrypt.mockRejectedValueOnce(new Error("PRF unavailable"))

    await expect(
      createPasskeyUnlockMethod({ title: "Shared" }, { id: "project", name: "project" }),
    ).rejects.toThrow("PRF unavailable")

    expect(mocks.createCredential).not.toHaveBeenCalled()
  })

  test("lazily enrolls once and encrypts with that credential after discovery fails", async () => {
    mocks.encrypt.mockRejectedValueOnce(new DOMException("No credential", "NotAllowedError"))
    mocks.createCredential.mockResolvedValue("new credential")

    const method = await createPasskeyUnlockMethod(
      { title: "Shared" },
      { id: "project", name: "project" },
    )

    expect(mocks.createCredential).toHaveBeenCalledExactlyOnceWith({ keyName: "Highstate" })

    expect(mocks.recipientOptions.mock.calls).toEqual([
      [undefined],
      [{ identity: "new credential" }],
    ])

    expect(mocks.encrypt).toHaveBeenCalledTimes(2)
    expect(method).toMatchObject({ type: "passkey", encryptedIdentity: "armored identity" })
  })

  test("stops when enrollment is cancelled", async () => {
    mocks.encrypt.mockRejectedValueOnce(new DOMException("No credential", "NotAllowedError"))
    mocks.createCredential.mockRejectedValueOnce(new DOMException("Cancelled", "NotAllowedError"))

    await expect(
      createPasskeyUnlockMethod({ title: "Shared" }, { id: "project", name: "project" }),
    ).rejects.toThrow("Cancelled")

    expect(mocks.createCredential).toHaveBeenCalledOnce()
    expect(mocks.encrypt).toHaveBeenCalledOnce()
  })

  test("does not repeat enrollment if the post-enrollment authentication fails", async () => {
    mocks.encrypt.mockRejectedValue(new DOMException("Cancelled", "NotAllowedError"))
    mocks.createCredential.mockResolvedValue("new credential")

    await expect(
      createPasskeyUnlockMethod({ title: "Shared" }, { id: "project", name: "project" }),
    ).rejects.toThrow("Cancelled")

    expect(mocks.createCredential).toHaveBeenCalledOnce()
    expect(mocks.encrypt).toHaveBeenCalledTimes(2)
  })

  test.each([
    false,
    true,
  ])("keyring creation delegates secrets and preserves startup preference %s", async autoUnlock => {
    const method = await createUnlockMethodFromForm(
      {
        type: "keyring",
        autoUnlock,
        title: "Server",
        description: "",
        password: "",
        confirmPassword: "",
      },
      { id: "project", name: "project" },
    )

    expect(method).toEqual({
      type: "keyring",
      meta: { title: "Server", description: "", autoUnlock },
    })

    expect(mocks.createCredential).not.toHaveBeenCalled()
  })
})

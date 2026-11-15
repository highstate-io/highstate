import { beforeEach, describe, expect, test, vi } from "vitest"

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

import { createPasskeyUnlockMethod, createUnlockMethodFromForm } from "."

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

  test("does not create a replacement credential when authentication fails", async () => {
    mocks.encrypt.mockRejectedValueOnce(new Error("Cancelled"))

    await expect(
      createPasskeyUnlockMethod({ title: "Shared" }, { id: "project", name: "project" }),
    ).rejects.toThrow("Cancelled")

    expect(mocks.createCredential).not.toHaveBeenCalled()
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

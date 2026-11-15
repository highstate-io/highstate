import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createCredential: vi.fn(),
  recipientOptions: vi.fn(),
  decrypt: vi.fn(),
  identityOptions: vi.fn(),
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

    async encrypt(): Promise<Uint8Array> {
      return new Uint8Array()
    }
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

import { createPasskeyUnlockMethod, createUnlockMethodFromForm, reusePasskeyUnlockMethod } from "."

describe("createPasskeyUnlockMethod", () => {
  beforeEach(() => {
    mocks.createCredential.mockReset()
    mocks.recipientOptions.mockReset()
    mocks.decrypt.mockReset().mockResolvedValue("identity")
    mocks.identityOptions.mockReset()
  })

  test("creates and uses a new WebAuthn credential", async () => {
    mocks.createCredential.mockResolvedValue("passkey identity")

    const unlockMethod = await createPasskeyUnlockMethod(
      {
        title: "YubiKey",
        description: "",
      },
      { id: "project-id", name: "home-lab" },
    )

    expect(mocks.createCredential).toHaveBeenCalledWith({
      keyName: "Highstate | YubiKey",
    })

    expect(mocks.recipientOptions).toHaveBeenCalledWith({ identity: "passkey identity" })

    expect(unlockMethod).toEqual({
      type: "passkey",
      meta: {
        title: "YubiKey",
        description: "",
      },
      encryptedIdentity: "armored identity",
      passkeyIdentity: "passkey identity",
      recipient: "recipient",
    })
  })

  test("promotes an existing passkey by authenticating and preserving its identity envelope", async () => {
    const passkey = { encryptedIdentity: "legacy envelope", passkeyIdentity: "legacy credential" }
    const method = await reusePasskeyUnlockMethod({ title: "Shared key" }, passkey)
    expect(mocks.identityOptions).toHaveBeenCalledWith({ identity: "legacy credential" })
    expect(mocks.decrypt).toHaveBeenCalledOnce()
    expect(mocks.createCredential).not.toHaveBeenCalled()

    expect(method).toEqual({
      type: "passkey",
      meta: { title: "Shared key" },
      ...passkey,
      recipient: "recipient",
    })
  })

  test("does not attach an existing passkey when authentication fails", async () => {
    mocks.decrypt.mockRejectedValueOnce(new Error("Cancelled"))

    await expect(
      reusePasskeyUnlockMethod(
        { title: "Shared" },
        {
          encryptedIdentity: "envelope",
          passkeyIdentity: "credential",
        },
      ),
    ).rejects.toThrow("Cancelled")

    expect(mocks.createCredential).not.toHaveBeenCalled()
  })

  test("keyring creation delegates secret generation to the backend", async () => {
    const method = await createUnlockMethodFromForm(
      {
        type: "keyring",
        title: "Server",
        description: "",
        password: "",
        confirmPassword: "",
      },
      { id: "project", name: "project" },
    )

    expect(method).toEqual({ type: "keyring", meta: { title: "Server", description: "" } })
    expect(mocks.createCredential).not.toHaveBeenCalled()
  })
})

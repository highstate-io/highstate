import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createCredential: vi.fn(),
  recipientOptions: vi.fn(),
}))

vi.mock("age-encryption", () => ({
  armor: {
    encode: vi.fn(() => "armored identity"),
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
  },
}))

import { createPasskeyUnlockMethod } from "."

describe("createPasskeyUnlockMethod", () => {
  beforeEach(() => {
    mocks.createCredential.mockReset()
    mocks.recipientOptions.mockReset()
  })

  test("creates and uses a new WebAuthn credential", async () => {
    mocks.createCredential.mockResolvedValue("passkey identity")

    const unlockMethod = await createPasskeyUnlockMethod({
      title: "YubiKey",
      description: "",
    })

    expect(mocks.createCredential).toHaveBeenCalledWith({ keyName: "YubiKey" })
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
})

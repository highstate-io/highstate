import { cuidv2d } from "@highstate/contract"
import { armor, Decrypter, generateIdentity, identityToRecipient } from "age-encryption"
import { describe, expect, it } from "vitest"
import {
  createBackendPrivateKey,
  createUnencryptedBackendPrivateKey,
  readBackendPrivateKey,
  readUnencryptedBackendPrivateKey,
} from "./backend"

const backendIdNamespace = "36d23d1d-b1ca-47d9-a5a3-664bb7aa250d"

describe("backend federation identity", () => {
  it("encrypts a generated private key and derives its backend ID", async () => {
    const databaseIdentity = await generateIdentity()
    const generated = await createBackendPrivateKey(databaseIdentity)
    const recipient = (await identityToRecipient(generated.privateKey)).trim()

    expect(generated.encryptedPrivateKey).toContain("-----BEGIN AGE ENCRYPTED FILE-----")
    expect(generated.encryptedPrivateKey).not.toContain(generated.privateKey)
    expect(generated.backendId).toBe(cuidv2d(backendIdNamespace, recipient))

    const decrypter = new Decrypter()
    decrypter.addIdentity(databaseIdentity)

    await expect(
      decrypter.decrypt(armor.decode(generated.encryptedPrivateKey), "text"),
    ).resolves.toBe(generated.privateKey)
  })

  it("restores the same private key and backend ID", async () => {
    const databaseIdentity = await generateIdentity()
    const generated = await createBackendPrivateKey(databaseIdentity)
    const restored = await readBackendPrivateKey(
      `\n${generated.encryptedPrivateKey.trim()}\n`,
      databaseIdentity,
    )

    expect(restored).toEqual({
      backendId: generated.backendId,
      privateKey: generated.privateKey,
    })
  })

  it("creates and restores a plaintext private key when encryption is disabled", async () => {
    const generated = await createUnencryptedBackendPrivateKey()
    const restored = await readUnencryptedBackendPrivateKey(generated.privateKey)

    expect(generated.privateKey).toMatch(/^AGE-SECRET-KEY-/)
    expect(restored).toEqual(generated)
  })

  it("rejects encrypted private keys when encryption is disabled", async () => {
    const databaseIdentity = await generateIdentity()
    const generated = await createBackendPrivateKey(databaseIdentity)

    await expect(readUnencryptedBackendPrivateKey(generated.encryptedPrivateKey)).rejects.toThrow(
      "Backend metadata is encrypted",
    )
  })
})

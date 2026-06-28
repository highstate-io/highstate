import { x25519 } from "@noble/curves/ed25519"
import { sha256 } from "@noble/hashes/sha2.js"
import { randomBytes } from "@noble/hashes/utils.js"

export function generateKey(): string {
  const key = x25519.utils.randomSecretKey()

  return Buffer.from(key).toString("base64")
}

export function convertPrivateKeyToPublicKey(privateKey: string): string {
  const key = Buffer.from(privateKey, "base64")

  return Buffer.from(x25519.getPublicKey(key)).toString("base64")
}

export function generatePresharedKey(): string {
  const key = randomBytes(32)

  return Buffer.from(key).toString("base64")
}

export function combinePresharedKeyParts(part1: string, part2: string): string {
  const key1 = Buffer.from(part1, "base64")
  const key2 = Buffer.from(part2, "base64")

  // combine the two parts in a deterministic order to ensure both sides generate the same key
  const combined = Buffer.concat([key1, key2].toSorted((a, b) => a.compare(b)))

  return Buffer.from(sha256(combined)).toString("base64")
}

import type { Blueprint } from "./shared"
import { decode, encode } from "@msgpack/msgpack"
import { xchacha20poly1305 } from "@noble/ciphers/chacha"
import { managedNonce, randomBytes } from "@noble/ciphers/webcrypto.js"

export async function shareBlueprint(blueprint: Blueprint): Promise<string> {
  // generate a random key for encryption
  const key = randomBytes(32)
  const chacha = managedNonce(xchacha20poly1305)(key)

  // encrypt the blueprint with the key
  const encoded = encode(blueprint)
  const encrypted = chacha.encrypt(encoded)

  throw new Error("Not implemented")
}

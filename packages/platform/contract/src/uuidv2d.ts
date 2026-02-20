import { sha3_512 } from "@noble/hashes/sha3.js"

const cuidv2DefaultLength = 24

function bufToBigInt(buf: Uint8Array): bigint {
  const bits = 8n

  let value = 0n
  for (const byte of buf.values()) {
    value = (value << bits) + BigInt(byte)
  }

  return value
}

function hashCuid2(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const digest = sha3_512(bytes)

  return bufToBigInt(digest).toString(36).slice(1)
}

/**
 * Generates a CUIDv2d string from the given namespace and identity.
 *
 * CUIDv2d is a Highstate-specific ID format that generates a deterministic ID in the same format as CUIDv2.
 *
 * It uses the same hash function and encoding as CUIDv2, but instead of randomly generated values, it generates the ID based on the given namespace and identity.
 *
 * The prefix of the generated ID is always "c".
 */
export function cuidv2d(namespace: string, identity: string): string {
  const hashInput = `${namespace}:${identity}`
  const hashed = hashCuid2(hashInput)
  const body = hashed.substring(1, cuidv2DefaultLength)

  return `c${body}`
}

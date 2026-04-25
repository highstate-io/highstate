import { sha256 } from "@noble/hashes/sha2.js"

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
  const digest = sha256(bytes)

  return bufToBigInt(digest).toString(36).slice(1)
}

function normalizeCuid2Prefix(prefix: string): string {
  if (prefix >= "a" && prefix <= "z") {
    return prefix
  }

  if (prefix >= "0" && prefix <= "9") {
    const digit = prefix.charCodeAt(0) - "0".charCodeAt(0)
    return String.fromCharCode("a".charCodeAt(0) + digit)
  }

  throw new Error(`Invalid CUID prefix character: ${prefix}`)
}

/**
 * Generates a CUIDv2d string from the given namespace and identity.
 *
 * CUIDv2d is a Highstate-specific ID format that generates a deterministic ID in the same format as CUIDv2.
 *
 * It uses the same encoding as CUIDv2, but instead of randomly generated values, it generates the ID based on the given namespace and identity.
 *
 * The generated ID is always 24 characters long.
 * The first character is guaranteed to be a letter (`a-z`) to match CUIDv2 expectations.
 * If the hash-derived first character would be a digit (`0-9`), it is deterministically mapped to a letter (`a-j`).
 */
export function cuidv2d(namespace: string, identity: string): string {
  const hashInput = `${namespace}:${identity}`
  const hashed = hashCuid2(hashInput)
  const raw = hashed.slice(0, cuidv2DefaultLength)
  const prefix = normalizeCuid2Prefix(raw[0]!)

  return `${prefix}${raw.slice(1)}`
}

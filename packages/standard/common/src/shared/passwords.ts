import { bytesToHex, randomBytes } from "@noble/hashes/utils.js"
import { secureMask } from "micro-key-producer/password.js"

/**
 * Generates a secure random password strong enough for online use.
 *
 * It uses "Safari Keychain Secure Password" format.
 *
 * The approximate entropy is [71 bits](https://support.apple.com/guide/security/automatic-strong-passwords-secc84c811c4/web).
 */
export function generatePassword(): string {
  return secureMask.apply(randomBytes(32)).password
}

type KeyFormatMap = {
  raw: Uint8Array
  hex: string
  base64: string
}

/**
 * Generates a secure random key strong enough for offline use such as encryption.
 *
 * The strong entropy is 256 bits.
 *
 * @param format The format of the generated key. By default, it is "hex".
 */
export function generateKey<TFormat extends keyof KeyFormatMap = "hex">(
  format: TFormat = "hex" as TFormat,
): KeyFormatMap[TFormat] {
  const bytes = randomBytes(32)

  if (format === "raw") {
    return bytes as KeyFormatMap[TFormat]
  }

  if (format === "base64") {
    return Buffer.from(bytes).toString("base64") as KeyFormatMap[TFormat]
  }

  return bytesToHex(bytes) as KeyFormatMap[TFormat]
}

import { Code } from "@connectrpc/connect"
import { createApiError } from "./api-error"

/**
 * Extracts a token from an HTTP Bearer authorization value.
 *
 * @param authorization The Authorization header value.
 * @returns The unmodified Bearer token.
 */
export function parseBearerToken(authorization: string | null): string {
  const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? "")
  if (
    !match ||
    [...match[1]!].some(character => character.charCodeAt(0) <= 0x1f || character === "\x7f")
  ) {
    throw createApiError({
      message: "Invalid authorization header",
      code: Code.Unauthenticated,
      reason: "AUTHORIZATION_HEADER_INVALID",
    })
  }

  return match[1]!
}

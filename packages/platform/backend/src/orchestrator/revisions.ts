import { createHash } from "node:crypto"
import { stableJsonStringify } from "../shared"

/**
 * Content revisions survive restarts and cover empty graphs as well as populated graphs.
 */
export function modelRevision(value: unknown): string {
  return createHash("sha256").update(stableJsonStringify(value)).digest("hex")
}

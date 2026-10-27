import type { WorkloadIntent } from "./contracts"
import { createHash } from "node:crypto"

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`)
      .join(",")}}`
  return JSON.stringify(value)
}

/** Only the digest is labeled; environment values and file contents never enter metadata. */
export function workloadFingerprint(intent: WorkloadIntent): string {
  return createHash("sha256")
    .update(
      canonical({
        ...intent,
        files: intent.files?.map(file => ({
          ...file,
          data: createHash("sha256").update(file.data).digest("hex"),
        })),
      }),
    )
    .digest("base64url")
}

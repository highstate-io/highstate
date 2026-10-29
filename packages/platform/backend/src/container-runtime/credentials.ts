import type { RuntimeOwnership } from "./contracts"
import { createHmac, timingSafeEqual } from "node:crypto"

export type RuntimePermission =
  | "connect"
  | "heartbeat"
  | "pulumi"
  | "evaluation"
  | "unit"
  | "sidecar"
  | "worker"
  | "proxy"
export type RuntimeCredential = RuntimeOwnership & {
  audience: "highstate-runtime-v1"
  expiresAt: number
  permissions: RuntimePermission[]
}

/**
 * Uses a runtime-only signing key, independent of public API key authentication.
 */
export class RuntimeCredentialSigner {
  constructor(
    private readonly backendId: string,
    private readonly key: Uint8Array,
    private readonly now: () => number = Date.now,
  ) {
    if (key.byteLength < 32) {
      throw new Error("Runtime signing key must contain at least 32 bytes")
    }
  }

  issue(owner: RuntimeOwnership, permissions: RuntimePermission[], expiresAt: number): string {
    if (owner.backendId !== this.backendId || expiresAt <= this.now()) {
      throw new Error("Invalid runtime credential scope")
    }

    const payload = Buffer.from(
      JSON.stringify({ ...owner, audience: "highstate-runtime-v1", permissions, expiresAt }),
    ).toString("base64url")

    return `${payload}.${createHmac("sha256", this.key).update(payload).digest("base64url")}`
  }

  verify(token: string, permission: RuntimePermission = "connect"): RuntimeCredential {
    if (token.length > 8192) {
      throw new Error("Invalid runtime credential")
    }

    const parts = token.split(".")
    if (parts.length !== 2) {
      throw new Error("Invalid runtime credential")
    }

    const signature = Buffer.from(parts[1]!, "base64url")
    const expected = createHmac("sha256", this.key).update(parts[0]!).digest()
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
      throw new Error("Invalid runtime signature")
    }

    const value = JSON.parse(Buffer.from(parts[0]!, "base64url").toString()) as RuntimeCredential
    if (
      value.audience !== "highstate-runtime-v1" ||
      value.backendId !== this.backendId ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= this.now() ||
      !Number.isSafeInteger(value.generation) ||
      !value.projectId ||
      !value.runtimeId ||
      !value.workloadId ||
      !Array.isArray(value.permissions) ||
      !value.permissions.includes(permission)
    ) {
      throw new Error("Runtime credential scope is invalid or expired")
    }

    return value
  }
}

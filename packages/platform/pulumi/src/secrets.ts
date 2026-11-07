import { HighstateSignature } from "@highstate/contract"
import { type ResourceTransform, runtime, secret } from "@pulumi/pulumi"

/**
 * Restores Highstate secret metadata at Pulumi's resolved resource-input boundary.
 * Contract entities remain plain values outside this boundary.
 */
export const protectResourceSecrets: ResourceTransform = args => ({
  props: protectValue(args.props) as Record<string, unknown>,
  opts: args.opts,
})

function protectValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(protectValue)
  }

  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    return value
  }

  const record = value as Record<string, unknown>

  // existing Pulumi secrets and other wire values are already serialized by the SDK
  if (runtime.specialSigKey in record) {
    return value
  }

  const result = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, protectValue(value)]),
  )

  if (record[HighstateSignature.Secret] === true && "value" in record) {
    result.value = secret(result.value)
  }

  return result
}

let registered = false

export function registerHighstateResourceTransform(): void {
  if (registered) {
    return
  }

  runtime.registerResourceTransform(protectResourceSecrets)
  registered = true
}

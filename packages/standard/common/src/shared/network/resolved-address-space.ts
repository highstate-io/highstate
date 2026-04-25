import { lookup } from "node:dns/promises"
import { check } from "@highstate/contract"
import { network } from "@highstate/library"
import { type AddressSpaceArgs, createAddressSpace, type InputAddressSpace } from "./address-space"
import { parseCidr, parseIp } from "./ip"

export type HostnameResolver = (hostname: string) => Promise<string[]>

const defaultHostnameResolver: HostnameResolver = async (hostname: string) => {
  const records = await lookup(hostname, { all: true })
  return records.map(record => record.address)
}

/**
 * Creates an address space from a list of addresses/subnets/ranges and resolves any hostname inputs.
 *
 * It accepts the same arguments as `createAddressSpace`, but also supports:
 * - Hostname `network.L3Endpoint` inputs;
 * - Hostname strings (FQDNs).
 *
 * Hostnames are resolved to IP addresses using the provided resolver and then passed to `createAddressSpace`.
 *
 * @param args The address space arguments.
 * @param resolver The hostname resolver function.
 * @returns The created address space entity.
 */
export async function createResolvedAddressSpace(
  args: AddressSpaceArgs,
  resolver: HostnameResolver = defaultHostnameResolver,
): Promise<network.AddressSpace> {
  const included = await resolveAddressSpaceInputs(args.included, resolver)
  const excluded = await resolveAddressSpaceInputs(args.excluded ?? [], resolver)

  return createAddressSpace({ included, excluded })
}

async function resolveAddressSpaceInputs(
  inputs: InputAddressSpace[],
  resolver: HostnameResolver,
): Promise<InputAddressSpace[]> {
  const resolved: InputAddressSpace[] = []

  for (const input of inputs) {
    const expanded = await resolveSingleInput(input, resolver)
    resolved.push(...expanded)
  }

  return resolved
}

async function resolveSingleInput(
  input: InputAddressSpace,
  resolver: HostnameResolver,
): Promise<InputAddressSpace[]> {
  if (typeof input === "string") {
    return await resolveStringInput(input, resolver)
  }

  if (check(network.l3EndpointEntity.schema, input) && input.type === "hostname") {
    return await resolveHostname(input.hostname, resolver)
  }

  return [input]
}

async function resolveStringInput(
  value: string,
  resolver: HostnameResolver,
): Promise<InputAddressSpace[]> {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error("Empty address string")
  }

  if (isRangeString(trimmed) || isCidrString(trimmed) || isIpString(trimmed)) {
    return [trimmed]
  }

  return await resolveHostname(trimmed, resolver)
}

function isCidrString(value: string): boolean {
  if (!value.includes("/")) return false

  try {
    parseCidr(value)
    return true
  } catch {
    return false
  }
}

function isIpString(value: string): boolean {
  if (!value) return false

  try {
    parseIp(value)
    return true
  } catch {
    return false
  }
}

function isRangeString(value: string): boolean {
  if (!value.includes("-")) return false

  const parts = value.split("-")
  if (parts.length !== 2) return false

  const left = parts[0]?.trim()
  const right = parts[1]?.trim()

  if (!left || !right) return false

  try {
    const a = parseIp(left)
    const b = parseIp(right)

    return a.type === b.type
  } catch {
    return false
  }
}

async function resolveHostname(
  hostname: string,
  resolver: HostnameResolver,
): Promise<InputAddressSpace[]> {
  let addresses: string[]

  try {
    addresses = await resolver(hostname)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to resolve hostname "${hostname}": ${message}`)
  }

  const unique = [...new Set(addresses.map(address => address.trim()).filter(Boolean))]

  for (const address of unique) {
    try {
      parseIp(address)
    } catch {
      throw new Error(`Resolver returned a non-IP address for hostname "${hostname}": "${address}"`)
    }
  }

  return unique
}

import { check } from "@highstate/contract"
import { network } from "@highstate/library"
import { ipToString, parseCidr, parseIp, subnetBaseFromCidr } from "./ip"

export type InputAddress = network.Address | string

/**
 * Parses and normalizes the given address string.
 * If Address entity is given, it is returned as-is.
 *
 * @param address The address to parse.
 * @returns The normalized Address entity.
 */
export function parseAddress(address: InputAddress): network.Address {
  if (check(network.addressEntity.schema, address)) {
    return address
  }

  const input = address.trim()
  if (!input) {
    throw new Error("Empty address string")
  }

  const parsed = input.includes("/") ? parseCidr(input) : parseCidrFromIp(input)
  const canonicalAddress = ipToString(parsed.type, parsed.ip)

  const subnetBase = subnetBaseFromCidr(parsed)
  const subnetBaseAddress = ipToString(parsed.type, subnetBase)

  const result: network.Address = {
    type: parsed.type,
    value: canonicalAddress,
    subnet: {
      type: parsed.type,
      baseAddress: subnetBaseAddress,
      prefixLength: parsed.prefixLength,
    },
  }

  const validated = network.addressEntity.schema.safeParse(result)
  if (!validated.success) {
    throw new Error(`Invalid address "${input}": ${validated.error.message}`)
  }

  return validated.data
}

/**
 * Converts an address entity to its full CIDR string representation.
 *
 * The result format is `<address>/<prefix-length>`.
 *
 * @param address The address entity.
 * @returns The CIDR string representation.
 */
export function addressToCidr(address: network.Address): string {
  return `${address.value}/${address.subnet.prefixLength}`
}

/**
 * Checks whether the given address belongs to the specified subnet.
 *
 * @param address The address to check.
 * @param subnet The subnet to check against.
 * @returns True if the address belongs to the subnet, false otherwise.
 */
export function doesAddressBelongToSubnet(
  address: network.Address,
  subnet: network.Subnet,
): boolean {
  if (address.type !== subnet.type) {
    return false
  }

  const addressIp = parseIp(address.value)
  const subnetBaseIp = parseIp(subnet.baseAddress)

  if (addressIp.type !== subnet.type || subnetBaseIp.type !== subnet.type) {
    return false
  }

  const bits = subnet.type === "ipv4" ? 32 : 128
  if (subnet.prefixLength === 0) {
    return true
  }

  const mask = ((1n << BigInt(subnet.prefixLength)) - 1n) << BigInt(bits - subnet.prefixLength)

  return (addressIp.value & mask) === (subnetBaseIp.value & mask)
}

/**
 * Merges duplicate addresses by their canonical CIDR key.
 *
 * If multiple addresses share the same `cidr`, the last one wins.
 *
 * @param addresses The list of addresses to merge.
 * @returns The merged list of addresses with duplicates removed.
 */
export function mergeAddresses(addresses: network.Address[]): network.Address[] {
  const mergedMap = new Map<string, network.Address>()

  for (const address of addresses) {
    mergedMap.set(addressToCidr(address), address)
  }

  return Array.from(mergedMap.values())
}

function parseCidrFromIp(value: string) {
  const parsed = parseIp(value)
  const prefixLength = parsed.type === "ipv4" ? 32 : 128

  return {
    type: parsed.type,
    ip: parsed.value,
    prefixLength,
  }
}

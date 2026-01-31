import { check } from "@highstate/contract"
import { network } from "@highstate/library"
import { type InputArray, toPromise } from "@highstate/pulumi"
import { filter, isNonNullish, map, pipe, uniqueBy } from "remeda"
import { doesAddressBelongToSubnet } from "./address"
import { ipToString, type ParsedCidr, parseCidr, parseIp, subnetBaseFromCidr } from "./ip"

export type InputSubnet = network.Subnet | network.Address | string

/**
 * Parses and normalizes the given subnet string.
 *
 * If a Subnet entity is given, it is returned as-is.
 *
 * @param subnet The subnet to parse.
 * @returns The normalized Subnet entity.
 */
export function parseSubnet(subnet: InputSubnet): network.Subnet {
  if (check(network.subnetEntity.schema, subnet)) {
    return subnet
  }

  if (check(network.addressEntity.schema, subnet)) {
    const prefixLength = subnet.type === "ipv4" ? 32 : 128

    const result: network.Subnet = {
      type: subnet.type,
      baseAddress: subnet.value,
      prefixLength,
    }

    const validated = network.subnetEntity.schema.safeParse(result)
    if (!validated.success) {
      throw new Error(
        `Invalid subnet "${subnet.value}/${prefixLength}": ${validated.error.message}`,
      )
    }

    return validated.data
  }

  const input = subnet.trim()
  if (!input) {
    throw new Error("Empty subnet string")
  }

  let parsed: ParsedCidr
  if (input.includes("/")) {
    parsed = parseCidr(input)
  } else {
    const ip = parseIp(input)
    const prefixLength = ip.type === "ipv4" ? 32 : 128
    parsed = { type: ip.type, ip: ip.value, prefixLength }
  }

  const subnetBase = subnetBaseFromCidr(parsed)
  const baseAddress = ipToString(parsed.type, subnetBase)

  const result: network.Subnet = {
    type: parsed.type,
    baseAddress,
    prefixLength: parsed.prefixLength,
  }

  const validated = network.subnetEntity.schema.safeParse(result)
  if (!validated.success) {
    throw new Error(`Invalid subnet "${input}": ${validated.error.message}`)
  }

  return validated.data
}

export const privateIpV4Subnets = [
  parseSubnet("10.0.0.0/8"),
  parseSubnet("127.0.0.0/8"),
  parseSubnet("172.16.0.0/12"),
  parseSubnet("192.168.0.0/16"),
]

export const privateIpV6Subnets = [
  parseSubnet("fc00::/7"),

  // IPv4-mapped private ranges.
  parseSubnet("::ffff:10.0.0.0/104"),
  parseSubnet("::ffff:127.0.0.0/104"),
  parseSubnet("::ffff:172.16.0.0/108"),
  parseSubnet("::ffff:192.168.0.0/112"),
]

export const privateSubnets = [...privateIpV4Subnets, ...privateIpV6Subnets]

/**
 * Checks whether the given address is a private address.
 *
 * @param address The address to check.
 * @returns True if the address is private, false otherwise.
 */
export function isPrivateAddress(address: network.Address): boolean {
  for (const subnet of privateSubnets) {
    if (doesAddressBelongToSubnet(address, subnet)) {
      return true
    }
  }

  return false
}

/**
 * Parses multiple subnets from strings and input objects.
 *
 * @param subnets The subnet strings to parse.
 * @param inputSubnets The input subnet objects to use.
 * @returns The parsed list of subnets objects with duplicates removed.
 */
export async function parseSubnets(
  subnets: (string | undefined | null)[] | null | undefined,
  inputSubnets: InputArray<network.Subnet | undefined | null> | null | undefined,
): Promise<network.Subnet[]> {
  const resolvedInputSubnets = await toPromise(inputSubnets ?? [])

  return pipe(
    [...(subnets ?? []), ...resolvedInputSubnets],
    filter(isNonNullish),
    map(subnet => parseSubnet(subnet)),
    uniqueBy(subnet => subnetToString(subnet)),
  )
}

/**
 * Converts a subnet to its canonical string representation (CIDR).
 *
 * @param subnet The subnet to convert.
 * @returns The string representation of the subnet.
 */
export function subnetToString(subnet: network.Subnet): string {
  return `${subnet.baseAddress}/${subnet.prefixLength}`
}

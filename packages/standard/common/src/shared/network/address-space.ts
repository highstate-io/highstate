import { check } from "@highstate/contract"
import { network } from "@highstate/library"
import { addressToCidr } from "./address"
import { cidrBlockSize, ipToString, parseCidr, parseIp, subnetBaseFromCidr } from "./ip"
import { subnetToString } from "./subnet"

export type AddressSpaceArgs = {
  /**
   * The list of addresses to include in the address space.
   *
   * Supports:
   * - Other address space entities;
   * - Address entities;
   * - Subnet entities;
   * - L3 endpoint entities;
   * - String representations of addresses, subnets, or ranges.
   *
   * The supported formats for strings are:
   * - Single IP address (e.g., `192.168.1.1`);
   * - CIDR notation (e.g., `192.168.1.1/24`);
   * - Dash notation (e.g., `192.168.1.1-192.168.1.254`).
   *
   * The addresses can be a mix of IPv4 and IPv6.
   */
  included: InputAddressSpace[]

  /**
   * The list of addresses to exclude from the `addresses` list.
   *
   * The supported formats are the same as in `addresses`.
   */
  excluded?: InputAddressSpace[]
}

export type InputAddressSpace =
  | network.AddressSpace
  | network.Address
  | network.Subnet
  | network.L3Endpoint
  | string

type IpFamily = network.AddressType

type IpRange = {
  family: IpFamily
  start: bigint
  endExclusive: bigint
}

/**
 * Creates an address space from a list of addresses/subnets/ranges.
 *
 * @param included The list of addresses to include in the address space.
 * @param excluded The list of addresses to exclude from the `included` list.
 * @returns The created address space entity.
 */
export function createAddressSpace({
  included,
  excluded = [],
}: AddressSpaceArgs): network.AddressSpace {
  const includedRanges = included.flatMap(resolveInputToRanges)
  const excludedRanges = excluded.flatMap(resolveInputToRanges)

  const normalized = normalizeRanges(includedRanges, excludedRanges)
  const subnets = rangesToCanonicalSubnets(normalized)

  return { subnets }
}

function resolveInputToRanges(input: InputAddressSpace): IpRange[] {
  if (typeof input === "string") {
    return [rangeFromString(input)]
  }

  if (check(network.addressSpaceEntity.schema, input)) {
    return input.subnets.flatMap(subnet => [rangeFromCidr(subnetToString(subnet))])
  }

  if (check(network.subnetEntity.schema, input)) {
    return [rangeFromCidr(subnetToString(input))]
  }

  if (check(network.addressEntity.schema, input)) {
    return [rangeFromCidr(addressToCidr(input))]
  }

  if (check(network.l3EndpointEntity.schema, input)) {
    if (input.type === "hostname") {
      return []
    }

    const cidr = (input as unknown as { cidr?: unknown }).cidr
    if (typeof cidr === "string") {
      return [rangeFromCidr(cidr)]
    }

    const address = (input as unknown as { address?: unknown }).address
    if (typeof address === "string") {
      const parsed = parseIp(address)
      const prefixLength = parsed.type === "ipv4" ? 32 : 128
      return [
        rangeFromParsedCidr({ family: parsed.type, base: parsed.value, prefix: prefixLength }),
      ]
    }

    if (check(network.addressEntity.schema, address)) {
      return [rangeFromCidr(addressToCidr(address))]
    }

    throw new Error("Invalid L3 endpoint: missing address information")
  }

  throw new Error("Unsupported address space input")
}

function rangeFromString(value: string): IpRange {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error("Empty address string")
  }

  if (trimmed.includes("-")) {
    const [left, right, ...rest] = trimmed.split("-")
    if (!left || !right || rest.length > 0) {
      throw new Error(`Invalid range: "${value}"`)
    }

    const start = parseIp(left.trim())
    const end = parseIp(right.trim())

    if (start.type !== end.type) {
      throw new Error(`Range must not mix IPv4 and IPv6: "${value}"`)
    }

    const min = start.value <= end.value ? start.value : end.value
    const max = start.value <= end.value ? end.value : start.value

    return {
      family: start.type,
      start: min,
      endExclusive: max + 1n,
    }
  }

  if (trimmed.includes("/")) {
    return rangeFromCidr(trimmed)
  }

  const parsed = parseIp(trimmed)
  return {
    family: parsed.type,
    start: parsed.value,
    endExclusive: parsed.value + 1n,
  }
}

function rangeFromCidr(cidr: string): IpRange {
  const parsed = parseCidr(cidr)
  return rangeFromParsedCidr({
    family: parsed.type,
    base: subnetBaseFromCidr(parsed),
    prefix: parsed.prefixLength,
  })
}

function rangeFromParsedCidr(parsed: { family: IpFamily; base: bigint; prefix: number }): IpRange {
  const size = cidrBlockSize(parsed.family, parsed.prefix)

  return {
    family: parsed.family,
    start: parsed.base,
    endExclusive: parsed.base + size,
  }
}

function normalizeRanges(included: IpRange[], excluded: IpRange[]): IpRange[] {
  const includedByFamily = splitByFamily(included)
  const excludedByFamily = splitByFamily(excluded)

  const normalizedV4 = subtractMergedRanges(
    mergeRanges(includedByFamily.v4),
    mergeRanges(excludedByFamily.v4),
  )
  const normalizedV6 = subtractMergedRanges(
    mergeRanges(includedByFamily.v6),
    mergeRanges(excludedByFamily.v6),
  )

  return [...normalizedV4, ...normalizedV6]
}

function splitByFamily(ranges: IpRange[]): { v4: IpRange[]; v6: IpRange[] } {
  const v4: IpRange[] = []
  const v6: IpRange[] = []

  for (const range of ranges) {
    if (range.start >= range.endExclusive) continue

    if (range.family === "ipv4") {
      v4.push(range)
    } else {
      v6.push(range)
    }
  }

  return { v4, v6 }
}

function mergeRanges(ranges: IpRange[]): IpRange[] {
  const sorted = [...ranges].sort((a, b) => {
    if (a.start === b.start) {
      return a.endExclusive < b.endExclusive ? -1 : a.endExclusive > b.endExclusive ? 1 : 0
    }
    return a.start < b.start ? -1 : 1
  })

  const merged: IpRange[] = []

  for (const current of sorted) {
    const last = merged.at(-1)
    if (!last) {
      merged.push({ ...current })
      continue
    }

    if (current.start <= last.endExclusive) {
      if (current.endExclusive > last.endExclusive) {
        last.endExclusive = current.endExclusive
      }
      continue
    }

    merged.push({ ...current })
  }

  return merged
}

function subtractMergedRanges(included: IpRange[], excluded: IpRange[]): IpRange[] {
  if (included.length === 0) return []
  if (excluded.length === 0) return included

  const result: IpRange[] = []
  let j = 0

  for (const incOriginal of included) {
    const inc: IpRange = { ...incOriginal }

    while (j < excluded.length && excluded[j]!.endExclusive <= inc.start) {
      j++
    }

    while (j < excluded.length) {
      const exc = excluded[j]!

      if (exc.start >= inc.endExclusive) {
        break
      }

      if (exc.start <= inc.start) {
        inc.start = inc.start < exc.endExclusive ? exc.endExclusive : inc.start
        if (inc.start >= inc.endExclusive) {
          break
        }

        if (exc.endExclusive <= inc.start) {
          j++
        }
        continue
      }

      result.push({
        family: inc.family,
        start: inc.start,
        endExclusive: exc.start,
      })

      inc.start = exc.endExclusive
      if (inc.start >= inc.endExclusive) {
        break
      }
    }

    if (inc.start < inc.endExclusive) {
      result.push(inc)
    }
  }

  return result
}

function rangesToCanonicalSubnets(ranges: IpRange[]): network.Subnet[] {
  const subnets: network.Subnet[] = []

  for (const range of ranges) {
    for (const cidr of rangeToCidrs(range)) {
      const baseAddress = ipToString(cidr.family, cidr.base)

      subnets.push({
        type: cidr.family,
        baseAddress,
        prefixLength: cidr.prefix,
      })
    }
  }

  return sortSubnetsCanonical(subnets)
}

function sortSubnetsCanonical(subnets: network.Subnet[]): network.Subnet[] {
  return [...subnets].sort((a, b) => {
    const aFamily = a.type
    const bFamily = b.type
    if (aFamily !== bFamily) {
      return aFamily === "ipv4" ? -1 : 1
    }

    const aBase = parseIp(a.baseAddress).value
    const bBase = parseIp(b.baseAddress).value

    if (aBase !== bBase) {
      return aBase < bBase ? -1 : 1
    }

    return a.prefixLength - b.prefixLength
  })
}

function rangeToCidrs(range: IpRange): Array<{ family: IpFamily; base: bigint; prefix: number }> {
  const bits = range.family === "ipv4" ? 32 : 128
  const result: Array<{ family: IpFamily; base: bigint; prefix: number }> = []

  let current = range.start
  while (current < range.endExclusive) {
    const remaining = range.endExclusive - current
    const maxAligned = current === 0n ? 1n << BigInt(bits) : current & -current
    const maxByRemaining = highestPowerOfTwoAtMost(remaining)

    const blockSize = maxAligned < maxByRemaining ? maxAligned : maxByRemaining
    const prefix = bits - bitLength(blockSize) + 1

    result.push({
      family: range.family,
      base: current,
      prefix,
    })

    current += blockSize
  }

  return result
}

function highestPowerOfTwoAtMost(value: bigint): bigint {
  if (value <= 0n) {
    throw new Error("Value must be positive")
  }

  return 1n << BigInt(bitLength(value) - 1)
}

function bitLength(value: bigint): number {
  return value.toString(2).length
}

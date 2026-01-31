import type { network } from "@highstate/library"

export type AddressType = network.AddressType

export type ParsedIp = {
  type: AddressType
  value: bigint
}

export type ParsedCidr = {
  type: AddressType
  ip: bigint
  prefixLength: number
}

export function parseIp(value: string): ParsedIp {
  if (value.includes(":")) {
    return { type: "ipv6", value: parseIpv6(value) }
  }

  return { type: "ipv4", value: parseIpv4(value) }
}

export function parseCidr(value: string): ParsedCidr {
  const [ipPart, prefixPart, ...rest] = value.split("/")
  if (!ipPart || !prefixPart || rest.length > 0) {
    throw new Error(`Invalid CIDR: "${value}"`)
  }

  const parsedIp = parseIp(ipPart.trim())
  const prefix = parseInt(prefixPart.trim(), 10)
  if (!Number.isFinite(prefix)) {
    throw new Error(`Invalid CIDR prefix: "${value}"`)
  }

  const bits = parsedIp.type === "ipv4" ? 32 : 128
  if (prefix < 0 || prefix > bits) {
    throw new Error(`Invalid CIDR prefix length: "${value}"`)
  }

  return { type: parsedIp.type, ip: parsedIp.value, prefixLength: prefix }
}

export function subnetBaseFromCidr(parsed: ParsedCidr): bigint {
  const bits = parsed.type === "ipv4" ? 32 : 128

  if (parsed.prefixLength === 0) {
    return 0n
  }

  const mask = ((1n << BigInt(parsed.prefixLength)) - 1n) << BigInt(bits - parsed.prefixLength)
  return parsed.ip & mask
}

export function cidrBlockSize(type: AddressType, prefixLength: number): bigint {
  const bits = type === "ipv4" ? 32 : 128
  return 1n << BigInt(bits - prefixLength)
}

export function ipToString(type: AddressType, value: bigint): string {
  return type === "ipv4" ? ipv4ToString(value) : ipv6ToString(value)
}

function parseIpv4(value: string): bigint {
  const parts = value.trim().split(".")
  if (parts.length !== 4) {
    throw new Error(`Invalid IPv4 address: "${value}"`)
  }

  let result = 0n
  for (const part of parts) {
    if (!part) {
      throw new Error(`Invalid IPv4 address: "${value}"`)
    }

    const octet = parseInt(part, 10)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      throw new Error(`Invalid IPv4 address: "${value}"`)
    }

    result = (result << 8n) + BigInt(octet)
  }

  return result
}

function parseIpv6(value: string): bigint {
  const input = value.trim().toLowerCase()
  if (!input) {
    throw new Error(`Invalid IPv6 address: "${value}"`)
  }

  let leftParts: string[] = []
  let rightParts: string[] = []

  const doubleColonIndex = input.indexOf("::")
  if (doubleColonIndex >= 0) {
    const [left, right] = input.split("::")
    leftParts = left ? left.split(":") : []
    rightParts = right ? right.split(":") : []
  } else {
    leftParts = input.split(":")
    rightParts = []
  }

  const expandIpv4Tail = (parts: string[]): string[] => {
    if (parts.length === 0) return parts
    const last = parts.at(-1)!
    if (!last.includes(".")) {
      return parts
    }

    const ipv4Value = parseIpv4(last)
    const high = Number((ipv4Value >> 16n) & 0xffffn)
    const low = Number(ipv4Value & 0xffffn)

    return [...parts.slice(0, -1), high.toString(16), low.toString(16)]
  }

  leftParts = leftParts.filter(p => p.length > 0)
  rightParts = rightParts.filter(p => p.length > 0)

  leftParts = expandIpv4Tail(leftParts)
  rightParts = expandIpv4Tail(rightParts)

  const totalParts = leftParts.length + rightParts.length
  if (doubleColonIndex < 0 && totalParts !== 8) {
    throw new Error(`Invalid IPv6 address: "${value}"`)
  }
  if (totalParts > 8) {
    throw new Error(`Invalid IPv6 address: "${value}"`)
  }

  const missing = 8 - totalParts
  const parts =
    doubleColonIndex >= 0
      ? [...leftParts, ...Array.from({ length: missing }, () => "0"), ...rightParts]
      : leftParts

  if (parts.length !== 8) {
    throw new Error(`Invalid IPv6 address: "${value}"`)
  }

  let result = 0n
  for (const part of parts) {
    if (!part) {
      throw new Error(`Invalid IPv6 address: "${value}"`)
    }

    const hextet = parseInt(part, 16)
    if (!Number.isInteger(hextet) || hextet < 0 || hextet > 0xffff) {
      throw new Error(`Invalid IPv6 address: "${value}"`)
    }

    result = (result << 16n) + BigInt(hextet)
  }

  return result
}

function ipv4ToString(value: bigint): string {
  const parts = [
    Number((value >> 24n) & 0xffn),
    Number((value >> 16n) & 0xffn),
    Number((value >> 8n) & 0xffn),
    Number(value & 0xffn),
  ]

  return parts.join(".")
}

function ipv6ToString(value: bigint): string {
  const hextets: number[] = []
  for (let i = 0; i < 8; i++) {
    const shift = BigInt((7 - i) * 16)
    hextets.push(Number((value >> shift) & 0xffffn))
  }

  // Find the longest run of zeros to compress.
  let bestStart = -1
  let bestLength = 0
  let currentStart = -1
  let currentLength = 0

  for (let i = 0; i < hextets.length; i++) {
    if (hextets[i] === 0) {
      if (currentStart === -1) {
        currentStart = i
        currentLength = 1
      } else {
        currentLength++
      }

      if (currentLength > bestLength) {
        bestStart = currentStart
        bestLength = currentLength
      }
    } else {
      currentStart = -1
      currentLength = 0
    }
  }

  // RFC 5952: only compress runs of 2+ hextets.
  if (bestLength < 2) {
    bestStart = -1
    bestLength = 0
  }

  const parts: string[] = []
  for (let i = 0; i < hextets.length; i++) {
    if (bestStart >= 0 && i >= bestStart && i < bestStart + bestLength) {
      if (i === bestStart) {
        parts.push("")
      }
      continue
    }

    parts.push(hextets[i]!.toString(16))
  }

  let result = parts.join(":")
  if (bestStart === 0) {
    result = `:${result}`
  }
  if (bestStart >= 0 && bestStart + bestLength === 8) {
    result = `${result}:`
  }

  if (result === "") {
    return "::"
  }

  // Normalize possible ":::" artifacts into "::".
  return result.replace(/:{3,}/g, "::")
}

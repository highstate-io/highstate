import { network } from "@highstate/library"
import { describe, expect, it } from "vitest"
import { parseAddress } from "./address"
import { parseSubnet, subnetToString } from "./subnet"

describe("parseSubnet", () => {
  it("parses an IPv4 CIDR string and canonicalizes the base address", () => {
    const result = parseSubnet("10.0.0.7/24")

    expect(result.type).toBe("ipv4")
    expect(result.baseAddress).toBe("10.0.0.0")
    expect(subnetToString(result)).toBe("10.0.0.0/24")
    expect(result.prefixLength).toBe(24)

    expect(network.subnetEntity.schema.safeParse(result).success).toBe(true)
  })

  it("treats an IPv4 address string as a /32 subnet", () => {
    const result = parseSubnet("10.0.0.7")

    expect(result.type).toBe("ipv4")
    expect(result.baseAddress).toBe("10.0.0.7")
    expect(subnetToString(result)).toBe("10.0.0.7/32")
    expect(result.prefixLength).toBe(32)
  })

  it("canonicalizes IPv6 subnet strings", () => {
    const result = parseSubnet("2001:db8:0:0:0:0:0:1/64")

    expect(result.type).toBe("ipv6")
    expect(result.baseAddress).toBe("2001:db8::")
    expect(subnetToString(result)).toBe("2001:db8::/64")
    expect(result.prefixLength).toBe(64)
  })

  it("treats an IPv6 address string as a /128 subnet", () => {
    const result = parseSubnet("2001:db8:0:0:0:0:0:1")

    expect(result.type).toBe("ipv6")
    expect(result.baseAddress).toBe("2001:db8::1")
    expect(subnetToString(result)).toBe("2001:db8::1/128")
    expect(result.prefixLength).toBe(128)
  })

  it("treats an Address entity as a host subnet", () => {
    const address = parseAddress("10.0.0.7")
    const result = parseSubnet(address)

    expect(result.type).toBe("ipv4")
    expect(result.baseAddress).toBe("10.0.0.7")
    expect(subnetToString(result)).toBe("10.0.0.7/32")
    expect(result.prefixLength).toBe(32)
  })

  it("throws on invalid subnet", () => {
    expect(() => parseSubnet("not-a-cidr")).toThrow(/Invalid/)
  })

  it("throws on invalid prefix", () => {
    expect(() => parseSubnet("10.0.0.0/33")).toThrow(/Invalid CIDR prefix length/)
  })
})

import { network } from "@highstate/library"
import { describe, expect, it } from "vitest"
import { addressToCidr, doesAddressBelongToSubnet, mergeAddresses, parseAddress } from "./address"
import { subnetToString } from "./subnet"

describe("parseAddress", () => {
  it("parses an IPv4 address string", () => {
    const result = parseAddress("10.0.0.1")

    expect(result.type).toBe("ipv4")
    expect(result.value).toBe("10.0.0.1")
    expect(addressToCidr(result)).toBe("10.0.0.1/32")
    expect(subnetToString(result.subnet)).toBe("10.0.0.1/32")
    expect(result.subnet.prefixLength).toBe(32)

    expect(network.addressEntity.schema.safeParse(result).success).toBe(true)
  })

  it("parses an IPv4 CIDR string as address/prefix", () => {
    const result = parseAddress("10.0.0.7/24")

    expect(result.type).toBe("ipv4")
    expect(result.value).toBe("10.0.0.7")
    expect(addressToCidr(result)).toBe("10.0.0.7/24")
    expect(subnetToString(result.subnet)).toBe("10.0.0.0/24")
    expect(result.subnet.baseAddress).toBe("10.0.0.0")
    expect(result.subnet.prefixLength).toBe(24)
  })

  it("canonicalizes IPv6 address strings", () => {
    const result = parseAddress("2001:db8:0:0:0:0:0:1")

    expect(result.type).toBe("ipv6")
    expect(result.value).toBe("2001:db8::1")
    expect(addressToCidr(result)).toBe("2001:db8::1/128")
    expect(subnetToString(result.subnet)).toBe("2001:db8::1/128")
    expect(result.subnet.prefixLength).toBe(128)
  })

  it("throws on invalid address", () => {
    expect(() => parseAddress("not-an-ip")).toThrow(/Invalid/)
  })

  it("throws on invalid prefix", () => {
    expect(() => parseAddress("10.0.0.1/33")).toThrow(/Invalid CIDR prefix length/)
  })
})

describe("doesAddressBelongToSubnet", () => {
  it("returns true when an IPv4 address belongs to the subnet", () => {
    const address = parseAddress("10.0.0.5")
    const subnet = parseAddress("10.0.0.0/24").subnet

    expect(doesAddressBelongToSubnet(address, subnet)).toBe(true)
  })

  it("returns false when an IPv4 address does not belong to the subnet", () => {
    const address = parseAddress("10.0.1.5")
    const subnet = parseAddress("10.0.0.0/24").subnet

    expect(doesAddressBelongToSubnet(address, subnet)).toBe(false)
  })

  it("treats /0 as containing every address", () => {
    const address = parseAddress("10.123.45.67")
    const subnet = parseAddress("0.0.0.0/0").subnet

    expect(doesAddressBelongToSubnet(address, subnet)).toBe(true)
  })

  it("returns true when an IPv6 address belongs to the subnet", () => {
    const address = parseAddress("2001:db8::1")
    const subnet = parseAddress("2001:db8::/64").subnet

    expect(doesAddressBelongToSubnet(address, subnet)).toBe(true)
  })

  it("returns false when an IPv6 address does not belong to the subnet", () => {
    const address = parseAddress("2001:db9::1")
    const subnet = parseAddress("2001:db8::/64").subnet

    expect(doesAddressBelongToSubnet(address, subnet)).toBe(false)
  })

  it("returns false for mismatched address and subnet types", () => {
    const address = parseAddress("10.0.0.1")
    const ipv6Subnet = parseAddress("2001:db8::/64").subnet

    expect(doesAddressBelongToSubnet(address, ipv6Subnet)).toBe(false)
  })
})

describe("mergeAddresses", () => {
  it("dedupes by cidr", () => {
    const a = parseAddress("10.0.0.1")
    const b = parseAddress("10.0.0.1")

    expect(mergeAddresses([a, b])).toEqual([b])
  })

  it("keeps stable order of last occurrences", () => {
    const a1 = parseAddress("10.0.0.1")
    const b1 = parseAddress("10.0.0.2")
    const a2 = parseAddress("10.0.0.1")
    const c1 = parseAddress("10.0.0.3")

    expect(mergeAddresses([a1, b1, a2, c1])).toEqual([a2, b1, c1])
  })
})

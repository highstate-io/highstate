import { network } from "@highstate/library"
import { describe, expect, it } from "vitest"
import { parseAddress } from "./address"
import { createAddressSpace } from "./address-space"
import { parseEndpoint } from "./endpoints"
import { subnetToString } from "./subnet"

describe("createAddressSpace", () => {
  it("returns a single canonical CIDR for adjacent subnets", () => {
    const result = createAddressSpace({
      included: ["10.0.0.0/25", "10.0.0.128/25"],
    })

    expect(result.subnets.map(subnetToString)).toEqual(["10.0.0.0/24"])
  })

  it("applies exclusions and keeps canonical ordering", () => {
    const result = createAddressSpace({
      included: ["10.0.0.0/24"],
      excluded: ["10.0.0.64/26"],
    })

    expect(result.subnets.map(subnetToString)).toEqual(["10.0.0.0/26", "10.0.0.128/25"])
  })

  it("converts dash ranges to a canonical CIDR list", () => {
    const result = createAddressSpace({
      included: ["10.0.0.10-10.0.0.20"],
    })

    expect(result.subnets.map(subnetToString)).toEqual([
      "10.0.0.10/31",
      "10.0.0.12/30",
      "10.0.0.16/30",
      "10.0.0.20/32",
    ])
  })

  it("ignores hostname L3 endpoints", () => {
    const hostnameEndpoint = parseEndpoint("example.com")

    const result = createAddressSpace({
      included: [hostnameEndpoint],
    })

    expect(result.subnets).toEqual([])
  })

  it("canonicalizes IPv6 addresses", () => {
    const result = createAddressSpace({
      included: ["2001:db8:0:0:0:0:0:1"],
    })

    expect(result.subnets.map(subnetToString)).toEqual(["2001:db8::1/128"])
  })

  it("produces a schema-valid address space", () => {
    const result = createAddressSpace({
      included: ["10.0.0.0/24", "2001:db8::1"],
      excluded: ["10.0.0.10"],
    })

    const parsed = network.addressSpaceEntity.schema.safeParse(result)
    expect(parsed.success).toBe(true)
  })

  it("accepts network.Subnet inputs", () => {
    const subnet = {
      type: "ipv4",
      baseAddress: "10.1.0.0",
      prefixLength: 24,
    } satisfies network.Subnet

    const result = createAddressSpace({
      included: [subnet],
    })

    expect(result.subnets.map(subnetToString)).toEqual(["10.1.0.0/24"])
  })

  it("accepts network.AddressSpace inputs", () => {
    const seed = createAddressSpace({
      included: ["10.2.0.0/25", "10.2.0.128/25"],
    })

    const addressSpace = seed satisfies network.AddressSpace

    const result = createAddressSpace({
      included: [addressSpace],
    })

    expect(result.subnets.map(subnetToString)).toEqual(["10.2.0.0/24"])
  })

  it("accepts network.Address inputs", () => {
    const address = parseAddress("10.3.0.7") satisfies network.Address

    const result = createAddressSpace({
      included: [address],
    })

    expect(result.subnets.map(subnetToString)).toEqual(["10.3.0.7/32"])
  })

  it("accepts non-hostname network.L3Endpoint inputs", () => {
    const endpoint = parseEndpoint("10.4.0.9")

    const result = createAddressSpace({
      included: [endpoint],
    })

    expect(result.subnets.map(subnetToString)).toEqual(["10.4.0.9/32"])
  })
})

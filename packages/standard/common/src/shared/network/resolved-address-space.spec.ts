import { describe, expect, it, vi } from "vitest"
import { parseEndpoint } from "./endpoints"
import { createResolvedAddressSpace } from "./resolved-address-space"
import { subnetToString } from "./subnet"

describe("createResolvedAddressSpace", () => {
  it("resolves hostname strings to addresses", async () => {
    const resolver = vi.fn(async (hostname: string) => {
      if (hostname === "example.com") return ["10.0.0.1"]
      return []
    })

    const result = await createResolvedAddressSpace({ included: ["example.com"] }, resolver)

    expect(resolver).toHaveBeenCalledWith("example.com")
    expect(result.subnets.map(subnetToString)).toEqual(["10.0.0.1/32"])
  })

  it("resolves hostname L3 endpoints to addresses", async () => {
    const resolver = vi.fn(async (hostname: string) => {
      if (hostname === "example.com") return ["10.0.0.7"]
      return []
    })

    const endpoint = parseEndpoint("example.com")

    const result = await createResolvedAddressSpace({ included: [endpoint] }, resolver)

    expect(resolver).toHaveBeenCalledWith("example.com")
    expect(result.subnets.map(subnetToString)).toEqual(["10.0.0.7/32"])
  })

  it("applies exclusions after resolving hostnames", async () => {
    const resolver = vi.fn(async (hostname: string) => {
      if (hostname === "included.example") return ["10.0.0.1", "10.0.0.2"]
      if (hostname === "excluded.example") return ["10.0.0.2"]
      return []
    })

    const result = await createResolvedAddressSpace(
      {
        included: ["included.example"],
        excluded: ["excluded.example"],
      },
      resolver,
    )

    expect(result.subnets.map(subnetToString)).toEqual(["10.0.0.1/32"])
  })

  it("treats dashed hostnames as hostnames, not ranges", async () => {
    const resolver = vi.fn(async (hostname: string) => {
      if (hostname === "api-1.example.com") return ["10.0.0.9"]
      return []
    })

    const result = await createResolvedAddressSpace({ included: ["api-1.example.com"] }, resolver)

    expect(resolver).toHaveBeenCalledWith("api-1.example.com")
    expect(result.subnets.map(subnetToString)).toEqual(["10.0.0.9/32"])
  })

  it("does not call resolver for IP/CIDR inputs", async () => {
    const resolver = vi.fn(async () => ["10.0.0.1"])

    const result = await createResolvedAddressSpace(
      { included: ["10.1.0.0/24", "10.1.0.7"] },
      resolver,
    )

    expect(resolver).not.toHaveBeenCalled()
    expect(result.subnets.map(subnetToString)).toEqual(["10.1.0.0/24"])
  })

  it("resolves ASN strings to announced prefixes", async () => {
    const hostnameResolver = vi.fn(async () => [])
    const asnResolver = vi.fn(async (asn: string) => {
      if (asn === "AS424242") {
        return ["198.51.100.0/24", "2001:db8:4242::/48"]
      }

      return []
    })

    const result = await createResolvedAddressSpace(
      { included: ["AS424242"] },
      hostnameResolver,
      asnResolver,
    )

    expect(asnResolver).toHaveBeenCalledWith("AS424242")
    expect(hostnameResolver).not.toHaveBeenCalled()
    expect(result.subnets.map(subnetToString)).toEqual(["198.51.100.0/24", "2001:db8:4242::/48"])
  })

  it("resolves ASN values in hostname endpoints", async () => {
    const hostnameResolver = vi.fn(async () => [])
    const asnResolver = vi.fn(async () => ["203.0.113.0/24"])

    const endpoint = parseEndpoint("AS424242")
    const result = await createResolvedAddressSpace(
      { included: [endpoint] },
      hostnameResolver,
      asnResolver,
    )

    expect(asnResolver).toHaveBeenCalledWith("AS424242")
    expect(hostnameResolver).not.toHaveBeenCalled()
    expect(result.subnets.map(subnetToString)).toEqual(["203.0.113.0/24"])
  })
})
